import { access, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { context, propagation } from "@opentelemetry/api";

import { workspaceConfig } from "@server/config/workspace.config";
import { executeChecked, executeProcess } from "@server/infrastructure/process/process.service";
import { createLogger } from "@server/shared/logger/logger.service";
import { parseOcrResult, renderOcrReport, reviewStatus } from "./ocr-result";

import type { ModelConfig } from "@server/modules/ai-models/ai-models.service";

const require = createRequire(import.meta.url);
const log = createLogger("ocr-engine");
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

export function shouldDisableThinking(model: Pick<ModelConfig, "provider" | "modelId">): boolean {
  const override = process.env.OCR_DISABLE_THINKING?.trim();
  if (override === "1") return true;
  if (override === "0") return false;
  return model.provider === "openai-compatible" && /deepseek/i.test(model.modelId);
}

type OcrConfig = Record<string, unknown>;

export function applyThinkingCompatibility(config: OcrConfig, model: Pick<ModelConfig, "provider" | "modelId">): { config: OcrConfig; changed: boolean } {
  if (!shouldDisableThinking(model)) return { config, changed: false };
  const llm = config.llm && typeof config.llm === "object" && !Array.isArray(config.llm) ? config.llm as OcrConfig : {};
  if (llm.extra_body && typeof llm.extra_body === "object" && !Array.isArray(llm.extra_body)
    && Object.hasOwn(llm.extra_body, "thinking")) return { config, changed: false };
  const extraBody = llm.extra_body && typeof llm.extra_body === "object" && !Array.isArray(llm.extra_body)
    ? llm.extra_body as OcrConfig : {};
  return { config: { ...config, llm: { ...llm, extra_body: { ...extraBody, thinking: { type: "disabled" } } } }, changed: true };
}

function prepareRuntimeLlmConfig(options: { stateDir: string; sharedStateDir: string; model: ModelConfig; baseUrl: string; protocol: string }): Promise<void> {
  const { stateDir, sharedStateDir, model, baseUrl, protocol } = options;
  if (stateDir === sharedStateDir) return Promise.resolve();
  const configDir = path.join(stateDir, ".opencodereview");
  const configFile = path.join(configDir, "config.json");
  const sharedConfigDir = path.join(sharedStateDir, ".opencodereview");
  const sessionsDir = path.join(sharedConfigDir, "sessions");
  return mkdir(configDir, { recursive: true, mode: 0o700 })
    .then(() => readFile(path.join(sharedConfigDir, "config.json"), "utf8").then((text) => {
      try {
        const config: unknown = JSON.parse(text);
        if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("配置必须为 JSON 对象");
        return config as OcrConfig;
      } catch {
        log.warn("OCR 共享配置格式无效，使用本次运行的模型配置，不改写原文件");
        return {};
      }
    }, (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }))
    .then((config) => {
      const result = applyThinkingCompatibility(config, model);
      const llm = result.config.llm as OcrConfig;
      /* OCR 不合并不完整配置与环境变量；独立 HOME 避免并发运行串用模型，密钥仅从子进程环境读取。 */
      return writeFile(configFile, JSON.stringify({ llm: { ...llm, url: baseUrl, model: model.modelId, protocol,
        auth_token: undefined, auth_token_cmd: 'printf \'%s\' "$OCR_LLM_TOKEN"',
      } }, null, 2), { mode: 0o600 });
    })
    .then(() => mkdir(sessionsDir, { recursive: true, mode: 0o700 }))
    .then(() => symlink(sessionsDir, path.join(configDir, "sessions"), "dir").catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return Promise.all([realpath(path.join(configDir, "sessions")), realpath(sessionsDir)]).then(([actual, expected]) => {
        if (actual !== expected) throw new Error("OCR 会话目录与仓库持久化目录不一致");
      });
    }));
}

function stripAnsi(text: string): string {
  return text.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

export function runOcr(request: OcrRequest) {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  const sharedStateDir = path.join(workspaceConfig.root, request.repositoryId, "ocr-home");
  const stateDir = shouldDisableThinking(request.model) ? path.join(sharedStateDir, "runs", request.id) : sharedStateDir;
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
    prepareRuntimeLlmConfig({ stateDir, sharedStateDir, model, baseUrl, protocol }),
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
