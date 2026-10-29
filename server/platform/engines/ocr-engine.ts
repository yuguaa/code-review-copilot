import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { context, propagation } from "@opentelemetry/api";

import { workspaceConfig } from "@server/config/workspace.config";
import { executeChecked, executeProcess } from "@server/infrastructure/process/process.service";
import { parseOcrResult, renderOcrReport, reviewStatus } from "./ocr-result";

import type { ModelConfig } from "@server/modules/ai-models/ai-models.service";

const require = createRequire(import.meta.url);
const platform = require("@alibaba-group/open-code-review/scripts/platform") as { resolveNativeBinary(): { path: string } | null };
const packageInfo = require("@alibaba-group/open-code-review/package.json") as { version: string };

export function ocrBinary(): string {
  const binary = platform.resolveNativeBinary();
  if (!binary) throw new Error("OCR 可执行文件不存在，请完成依赖安装");
  return binary.path;
}

export function verifyOcrVersion(): Promise<string> {
  return executeChecked(ocrBinary(), ["version"]).then((version) => {
    if (!version.includes(`v${packageInfo.version} `)) throw new Error("OCR 可执行文件与依赖版本不一致");
    return packageInfo.version;
  });
}

export function redactSecrets(text: string, secrets: Array<string | null | undefined>): string {
  return secrets.filter((secret): secret is string => Boolean(secret))
    .sort((left, right) => right.length - left.length)
    .reduce((result, secret) => result.replaceAll(secret, "[REDACTED]"), text);
}

function ensureCompatibleLlmConfig(stateDir: string, model: ModelConfig): Promise<void> {
  if (model.provider !== "openai-compatible") return Promise.resolve();
  const configDir = path.join(stateDir, ".opencodereview");
  const configFile = path.join(configDir, "config.json");
  return mkdir(configDir, { recursive: true }).then(() => readFile(configFile, "utf8").then((text) => JSON.parse(text) as Record<string, unknown>, (error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {} as Record<string, unknown>;
    throw error;
  })).then((config) => {
    const llm = config.llm && typeof config.llm === "object" && !Array.isArray(config.llm) ? config.llm as Record<string, unknown> : {};
    const extraBody = llm.extra_body && typeof llm.extra_body === "object" && !Array.isArray(llm.extra_body)
      ? llm.extra_body as Record<string, unknown> : {};
    llm.extra_body = { ...extraBody, thinking: { type: "disabled" } };
    return writeFile(configFile, JSON.stringify({ ...config, llm }, null, 2), { mode: 0o600 });
  }).then(() => undefined);
}

function stripAnsi(text: string): string {
  return text.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

export function runOcr(request: OcrRequest) {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  const stateDir = path.join(workspaceConfig.root, request.repositoryId, "ocr-home");
  const backgroundFile = path.join(workspaceConfig.root, request.repositoryId, "artifacts", request.id, "background.md");
  const model = request.model;
  const protocol = model.provider === "anthropic" ? "anthropic" : model.provider === "openai" ? "openai-responses" : "openai";
  const baseUrl = model.apiBaseUrl || (model.provider === "anthropic" ? "https://api.anthropic.com" : model.provider === "openai" ? "https://api.openai.com/v1" : "");
  if (!baseUrl || !model.apiKey) throw new Error("OCR 模型地址或凭证缺失");
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    LANG: process.env.LANG ?? "C.UTF-8",
    HOME: stateDir,
    USERPROFILE: stateDir,
    TMPDIR: path.join(stateDir, "tmp"),
    OCR_NO_UPDATE: "1",
    OCR_LLM_URL: baseUrl,
    OCR_LLM_TOKEN: model.apiKey,
    OCR_LLM_MODEL: model.modelId,
    OCR_LLM_PROTOCOL: protocol,
    OCR_LLM_TIMEOUT: "120",
    OCR_ENABLE_TELEMETRY: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ? "1" : "0",
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    OTEL_EXPORTER_OTLP_PROTOCOL: "grpc",
    OTEL_SERVICE_NAME: "code-review-ocr",
    TRACEPARENT: carrier.traceparent ?? request.traceparent,
    OTEL_RESOURCE_ATTRIBUTES: `run.id=${request.id},repository.id=${request.repositoryId},engine.key=ocr-review`,
    OCR_CONTENT_LOGGING: "0",
  };
  const baseArgs = ["review", "--repo", request.workdir, "--from", request.baseSha, "--to", request.headSha,
    "--format", "json", "--audience", "human", "--color", "never",
    "--concurrency", String(request.concurrency), "--timeout", String(request.timeoutMinutes),
    "--max-tokens-budget", String(request.maxTokensBudget), "--background-file", backgroundFile];
  const ruleFile = path.join(workspaceConfig.root, request.repositoryId, "artifacts", request.id, "review-rule.json");
  const projectRuleFile = path.join(request.workdir, ".opencodereview", "rule.json");
  const prepareRule = access(projectRuleFile).then(() => true, () => false).then((hasProjectRule) => {
    if (hasProjectRule || !request.reviewRule?.trim()) return hasProjectRule;
    return mkdir(path.dirname(ruleFile), { recursive: true })
      .then(() => writeFile(ruleFile, JSON.stringify({ rules: [{
        path: "**/*", rule: request.reviewRule, merge_system_rule: true,
      }] }, null, 2), { mode: 0o600 }))
      .then(() => false);
  });
  let stderrBuffer = "";
  const emitProgressLines = (chunk: Buffer, flush = false) => {
    stderrBuffer += chunk.toString("utf8");
    const parts = stderrBuffer.split(/\r\n|\n|\r/);
    stderrBuffer = flush ? "" : parts.pop() ?? "";
    for (const part of parts) {
      const line = redactSecrets(stripAnsi(part).trim(), [model.apiKey]);
      if (line) request.onProgress?.(line);
    }
  };
  return Promise.all([
    mkdir(path.join(stateDir, "tmp"), { recursive: true }),
    mkdir(path.dirname(backgroundFile), { recursive: true }),
    ensureCompatibleLlmConfig(stateDir, model),
    prepareRule,
  ])
    .then(([, , , hasProjectRule]) => ({
      args: hasProjectRule ? baseArgs : [...baseArgs, ...(request.reviewRule?.trim() ? ["--rule", ruleFile] : [])],
      background: hasProjectRule && request.reviewRule?.trim()
        ? `${request.background}\n\n${request.reviewRule}` : request.background,
    }))
    .then(({ args, background }) => writeFile(backgroundFile, background, { mode: 0o600 }).then(() => args))
    .then((args) => executeProcess(ocrBinary(), args, {
      cwd: request.workdir, env, signal: request.signal, timeoutMs: 60 * 60_000,
      onStderr: (chunk) => emitProgressLines(chunk),
    }))
    .then((processResult) => {
      emitProgressLines(Buffer.alloc(0), true);
      if (processResult.error) throw processResult.error;
      if (!processResult.stdout.trim()) throw new Error(`OCR 没有输出结果，退出状态 ${processResult.code ?? processResult.signal}`);
      const safe = redactSecrets(processResult.stdout, [model.apiKey]);
      const result = parseOcrResult(safe);
      return {
        rawResult: result,
        report: renderOcrReport(result, request),
        status: reviewStatus(result, processResult.code),
        engineSessionId: result.session_id,
        exitCode: processResult.code,
      };
    });
}

export type OcrRequest = {
  id: string;
  repositoryId: string;
  workdir: string;
  baseSha: string;
  headSha: string;
  model: ModelConfig;
  background: string;
  concurrency: number;
  timeoutMinutes: number;
  maxTokensBudget: number;
  traceparent: string;
  signal: AbortSignal;
  reviewRule?: string;
  onProgress?: (message: string) => void;
};
