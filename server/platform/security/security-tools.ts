import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { z } from "zod";

import {
  createSecurityArtifactTarget,
  describeSecurityArtifact,
  type SecurityArtifactMetadata,
} from "./security-artifacts";
import { assertUrlInScope, isUrlInScope } from "./security-scope";

export const SECURITY_TOOL_NAMES = [
  "security_http_request",
  "security_browser",
  "security_record_finding",
  "security_finish",
] as const;

export type SecurityToolName = typeof SECURITY_TOOL_NAMES[number];

export type SecurityTrafficRecord = {
  method: string;
  url: string;
  statusCode: number | null;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string> | null;
  bodyPreview: string | null;
  contentHash: string | null;
  durationMs: number;
};

export type SecurityArtifactRecord = SecurityArtifactMetadata & {
  type: string;
};

export type SecurityFindingRecord = {
  fingerprint: string;
  category?: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  confidence: "high" | "medium" | "low";
  title: string;
  description: string;
  evidence: string;
  remediation: string;
};

export type SecurityFinishRecord = {
  summary: string;
  riskScore: number;
  report: string;
};

export type SecurityToolIdentity = {
  id: string;
  name: string;
  role: string;
  username: string;
  password: string;
};

export type SecurityToolHost = {
  ticketId: string;
  executionId: string;
  scopeDomains: readonly string[];
  artifactRoot: string;
  agentBrowserBin: string;
  actionPolicyPath: string;
  sessionId: string;
  getIdentity(identityId: string): Promise<SecurityToolIdentity | undefined> | SecurityToolIdentity | undefined;
  recordTraffic(input: SecurityTrafficRecord): Promise<void> | void;
  recordArtifact(input: SecurityArtifactRecord): Promise<void> | void;
  recordFinding(input: SecurityFindingRecord): Promise<void> | void;
  finish(input: SecurityFinishRecord): Promise<void> | void;
};

const allowedHttpMethods = ["GET", "HEAD", "POST", "PUT", "PATCH", "OPTIONS"] as const;
const maxHttpResponseBytes = 1024 * 1024;
const maxBrowserOutputBytes = 4 * 1024 * 1024;
const redactedValue = "[REDACTED]";
const sensitiveHeaders = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
]);
const sensitiveHeaderPattern = /(?:^|[-_])(authorization|auth|token|secret|password|passwd|api[-_]?key|cookie|session|csrf)(?:$|[-_])/i;

const httpRequestParameters = Type.Object({
  method: Type.Union(allowedHttpMethods.map((method) => Type.Literal(method))),
  url: Type.String({ minLength: 1, maxLength: 4096 }),
  identityId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  headers: Type.Optional(Type.Record(Type.String(), Type.String())),
  body: Type.Optional(Type.String({ maxLength: 1024 * 1024 })),
}, { additionalProperties: false });

const browserParameters = Type.Object({
  action: Type.Union([
    Type.Literal("open"),
    Type.Literal("snapshot"),
    Type.Literal("click"),
    Type.Literal("fill"),
    Type.Literal("login"),
    Type.Literal("network_requests"),
    Type.Literal("screenshot"),
    Type.Literal("close"),
  ]),
  url: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
  ref: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  value: Type.Optional(Type.String({ maxLength: 1024 * 1024 })),
  identityId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  usernameRef: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  passwordRef: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  submitRef: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  filename: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
}, { additionalProperties: false });

const browserNetworkRequest = z.object({
  requestId: z.string().min(1),
  method: z.string().min(1),
  url: z.string().url(),
  status: z.number().int().nonnegative().nullable(),
  headers: z.record(z.string()).default({}),
  responseHeaders: z.record(z.string()).nullable().optional(),
  resourceType: z.string().optional(),
  mimeType: z.string().nullable().optional(),
});

const browserNetworkResult = z.object({
  success: z.boolean(),
  error: z.unknown().nullable(),
  data: z.object({
    requests: z.array(browserNetworkRequest),
  }),
}).passthrough();

type BrowserNetworkRequest = z.infer<typeof browserNetworkRequest>;

const findingParameters = Type.Object({
  fingerprint: Type.String({ minLength: 1, maxLength: 200 }),
  category: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  severity: Type.Union([
    Type.Literal("critical"),
    Type.Literal("high"),
    Type.Literal("medium"),
    Type.Literal("low"),
    Type.Literal("info"),
  ]),
  confidence: Type.Union([
    Type.Literal("high"),
    Type.Literal("medium"),
    Type.Literal("low"),
  ]),
  title: Type.String({ minLength: 1, maxLength: 500 }),
  description: Type.String({ minLength: 1, maxLength: 20_000 }),
  evidence: Type.String({ minLength: 1, maxLength: 200_000 }),
  remediation: Type.String({ minLength: 1, maxLength: 20_000 }),
}, { additionalProperties: false });

const finishParameters = Type.Object({
  summary: Type.String({ minLength: 1, maxLength: 20_000 }),
  riskScore: Type.Integer({ minimum: 0, maximum: 100 }),
  report: Type.String({ minLength: 1, maxLength: 2_000_000 }),
}, { additionalProperties: false });

type HttpRequestParameters = Static<typeof httpRequestParameters>;
type BrowserParameters = Static<typeof browserParameters>;
type FindingParameters = Static<typeof findingParameters>;
type FinishParameters = Static<typeof finishParameters>;

function textResult(text: string, details: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function abortReason(signal: AbortSignal, fallback: string): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  if (typeof reason === "string" && reason) return new Error(reason);
  return new Error(fallback);
}

function isSensitiveHeader(name: string): boolean {
  return sensitiveHeaders.has(name.toLowerCase()) || sensitiveHeaderPattern.test(name);
}

function safeHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, name) => {
    result[name] = isSensitiveHeader(name) ? redactedValue : value;
  });
  return result;
}

export function safeHeaderRecord(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [
    name,
    isSensitiveHeader(name) ? redactedValue : value,
  ]));
}

function parseBrowserNetworkRequests(output: string): BrowserNetworkRequest[] {
  const result = browserNetworkResult.parse(JSON.parse(output));
  if (!result.success) throw new Error(`读取 agent-browser 网络请求失败：${JSON.stringify(result.error)}`);
  return result.data.requests;
}

function basicAuthorization(identity: SecurityToolIdentity): string {
  if (!identity.username || !identity.password) throw new Error("身份凭据不完整");
  return `Basic ${Buffer.from(`${identity.username}:${identity.password}`, "utf8").toString("base64")}`;
}

function resolveAuthorization(
  host: SecurityToolHost,
  identityId: string | undefined,
): Promise<string | undefined> {
  if (!identityId) return Promise.resolve(undefined);
  return Promise.resolve(host.getIdentity(identityId)).then((identity) => {
    if (!identity) throw new Error(`身份不存在或已经停用：${identityId}`);
    return basicAuthorization(identity);
  });
}

function readLimitedResponseBody(
  response: Response,
  signal: AbortSignal | undefined,
): Promise<{ data: Buffer; truncated: boolean }> {
  if (!response.body) return Promise.resolve({ data: Buffer.alloc(0), truncated: false });

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;

  const readNext = (): Promise<{ data: Buffer; truncated: boolean }> => {
    if (signal?.aborted) {
      return reader.cancel().then(() => Promise.reject(abortReason(signal, "请求已经取消")));
    }

    return reader.read().then(({ done, value }) => {
      if (done) return { data: Buffer.concat(chunks, size), truncated };
      if (!value) return readNext();

      const remaining = maxHttpResponseBytes - size;
      if (value.byteLength > remaining) {
        if (remaining > 0) {
          const part = Buffer.from(value.subarray(0, remaining));
          chunks.push(part);
          size += part.byteLength;
        }
        truncated = true;
        return reader.cancel().then(() => ({ data: Buffer.concat(chunks, size), truncated }));
      }

      const part = Buffer.from(value);
      chunks.push(part);
      size += part.byteLength;
      return readNext();
    });
  };

  return readNext();
}

function executeHttpRequest(
  host: SecurityToolHost,
  params: HttpRequestParameters,
  signal: AbortSignal | undefined,
) {
  const method = params.method as string;
  if (method === "DELETE" || !allowedHttpMethods.includes(method as typeof allowedHttpMethods[number])) {
    throw new Error("security_http_request 拒绝 DELETE 和其他未授权方法");
  }
  if ((method === "GET" || method === "HEAD") && params.body !== undefined) {
    throw new Error(`${method} 请求不能包含 body`);
  }

  assertUrlInScope(params.url, host.scopeDomains);

  return resolveAuthorization(host, params.identityId).then((authorization) => {
    const headers = new Headers(params.headers);
    if (authorization) headers.set("Authorization", authorization);
    const requestHeaders = safeHeaders(headers);
    const startedAt = performance.now();

    return fetch(params.url, {
      method,
      headers,
      body: params.body,
      redirect: "manual",
      signal,
    }).then(async (response) => {
      let responseBody: { data: Buffer; truncated: boolean };
      try {
        responseBody = await readLimitedResponseBody(response, signal);
      } catch (error) {
        const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
        await host.recordTraffic({
          method,
          url: params.url,
          statusCode: response.status,
          requestHeaders,
          responseHeaders: safeHeaders(response.headers),
          bodyPreview: error instanceof Error ? error.message : "响应读取失败",
          contentHash: null,
          durationMs,
        });
        throw error;
      }

      const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
      const responseHeaders = safeHeaders(response.headers);
      const bodyPreview = responseBody.data.byteLength ? new TextDecoder().decode(responseBody.data) : null;
      const contentHash = createHash("sha256").update(responseBody.data).digest("hex");
      await host.recordTraffic({
        method,
        url: params.url,
        statusCode: response.status,
        requestHeaders,
        responseHeaders,
        bodyPreview,
        contentHash,
        durationMs,
      });

      const bodyText = bodyPreview ?? "(空响应)";
      const resultText = [
        `${response.status} ${response.statusText}`.trim(),
        JSON.stringify(responseHeaders, null, 2),
        "",
        bodyText,
        ...(responseBody.truncated ? ["", "[响应已经截断到 1 MiB]"] : []),
      ].join("\n");

      return textResult(resultText, {
        method,
        url: params.url,
        statusCode: response.status,
        requestHeaders,
        responseHeaders,
        bodyPreview,
        contentHash,
        durationMs,
        truncated: responseBody.truncated,
      });
    }, async (error: unknown) => {
      const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
      await host.recordTraffic({
        method,
        url: params.url,
        statusCode: null,
        requestHeaders,
        responseHeaders: null,
        bodyPreview: error instanceof Error ? error.message : "请求失败",
        contentHash: null,
        durationMs,
      });
      throw error;
    });
  });
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`security_browser 缺少参数：${name}`);
  return value;
}

function runAgentBrowserCommand(
  binary: string,
  args: string[],
  options: {
    action: string;
    input?: string;
    signal?: AbortSignal;
    redactions?: string[];
  },
): Promise<string> {
  if (options.signal?.aborted) return Promise.reject(abortReason(options.signal, "浏览器操作已经取消"));

  return new Promise((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const child = spawn(binary, args, {
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const cleanup = () => {
      options.signal?.removeEventListener("abort", abort);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      child.kill("SIGTERM");
      reject(error);
    };
    const abort = () => fail(abortReason(options.signal!, "浏览器操作已经取消"));
    const collect = (chunks: Buffer[], chunk: Buffer, stream: "stdout" | "stderr") => {
      if (settled) return;
      if (stream === "stdout") stdoutBytes += chunk.byteLength;
      else stderrBytes += chunk.byteLength;
      if (stdoutBytes + stderrBytes > maxBrowserOutputBytes) {
        fail(new Error("agent-browser 输出超过 4 MiB"));
        return;
      }
      chunks.push(chunk);
    };
    const redact = (value: string) => {
      let result = value;
      for (const secret of options.redactions ?? []) {
        if (!secret) continue;
        result = result.split(secret).join(redactedValue);
        const encoded = JSON.stringify(secret).slice(1, -1);
        if (encoded && encoded !== secret) result = result.split(encoded).join(redactedValue);
      }
      return result;
    };

    child.stdout.on("data", (chunk: Buffer) => collect(stdoutChunks, chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => collect(stderrChunks, chunk, "stderr"));
    child.stdin.on("error", (error) => fail(new Error(`agent-browser 输入失败：${error.message}`)));
    child.on("error", (error) => fail(error));
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();

      if (options.signal?.aborted) {
        reject(abortReason(options.signal, "浏览器操作已经取消"));
        return;
      }
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks, stdoutBytes).toString("utf8"));
        return;
      }

      const stderr = Buffer.concat(stderrChunks, stderrBytes).toString("utf8").trim();
      const stdout = Buffer.concat(stdoutChunks, stdoutBytes).toString("utf8").trim();
      const output = redact([stderr, stdout].filter(Boolean).join("\n"));
      reject(new Error(output
        ? `agent-browser ${options.action} 执行失败（退出码 ${code}）：${output}`
        : `agent-browser ${options.action} 执行失败（退出码 ${code}）`));
    });

    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdin.end(options.input);
  });
}

type BrowserCommandHost = Pick<SecurityToolHost, "scopeDomains" | "agentBrowserBin" | "actionPolicyPath" | "sessionId">;

function browserCommandArgs(host: BrowserCommandHost, actionArgs: string[]): string[] {
  return [
    "--session", host.sessionId,
    "--allowed-domains", host.scopeDomains.join(","),
    "--action-policy", host.actionPolicyPath,
    "--content-boundaries",
    "--max-output", "50000",
    ...actionArgs,
  ];
}

async function executeBrowserAction(
  host: SecurityToolHost,
  params: BrowserParameters,
  signal: AbortSignal | undefined,
  recordedRequestIds: Set<string>,
) {
  switch (params.action) {
    case "open": {
      const url = required(params.url, "url");
      assertUrlInScope(url, host.scopeDomains);
      const output = await runAgentBrowserCommand(host.agentBrowserBin, browserCommandArgs(host, ["open", url, "--json"]), {
        action: "open",
        signal,
      });
      const screenshot = await captureBrowserScreenshot(host, `page-${Date.now()}.png`, signal);
      return textResult(`${output.trim() || "页面已经打开"}\n截图已经保存：${screenshot.filename}`, {
        action: "open",
        url,
        screenshot,
      });
    }
    case "snapshot": {
      const output = await runAgentBrowserCommand(host.agentBrowserBin, browserCommandArgs(host, ["snapshot", "-i", "--json"]), {
        action: "snapshot",
        signal,
      });
      return textResult(output.trim() || "页面快照为空", { action: "snapshot" });
    }
    case "click": {
      const ref = required(params.ref, "ref");
      const output = await runAgentBrowserCommand(host.agentBrowserBin, browserCommandArgs(host, ["click", ref, "--json"]), {
        action: "click",
        signal,
      });
      return textResult(output.trim() || `已经点击 ${ref}`, { action: "click", ref });
    }
    case "fill": {
      const ref = required(params.ref, "ref");
      const value = required(params.value, "value");
      const output = await runAgentBrowserCommand(host.agentBrowserBin, browserCommandArgs(host, ["fill", ref, value, "--json"]), {
        action: "fill",
        signal,
        redactions: [value],
      });
      return textResult(output.trim() || `已经填充 ${ref}`, { action: "fill", ref });
    }
    case "login": {
      const identityId = required(params.identityId, "identityId");
      const usernameRef = required(params.usernameRef, "usernameRef");
      const passwordRef = required(params.passwordRef, "passwordRef");
      const identity = await host.getIdentity(identityId);
      if (!identity) throw new Error(`身份不存在或已经停用：${identityId}`);
      if (!identity.username || !identity.password) throw new Error("身份凭据不完整");

      const commands: string[][] = [
        ["fill", usernameRef, identity.username],
        ["fill", passwordRef, identity.password],
      ];
      if (params.submitRef) commands.push(["click", params.submitRef]);

      await runAgentBrowserCommand(
        host.agentBrowserBin,
        browserCommandArgs(host, ["batch", "--bail", "--json"]),
        {
          action: "login",
          input: JSON.stringify(commands),
          signal,
          redactions: [identity.password],
        },
      );
      return textResult("登录表单已经填充" + (params.submitRef ? "并提交" : ""), {
        action: "login",
        identityId,
        submitted: Boolean(params.submitRef),
      });
    }
    case "network_requests": {
      const output = await runAgentBrowserCommand(
        host.agentBrowserBin,
        browserCommandArgs(host, ["network", "requests", "--json"]),
        { action: "network_requests", signal },
      );
      const requests = parseBrowserNetworkRequests(output);
      const inScope = requests.filter((request) => isUrlInScope(request.url, host.scopeDomains));
      const fresh = inScope.filter((request) => !recordedRequestIds.has(request.requestId));

      await Promise.all(fresh.map((request) => Promise.resolve(host.recordTraffic({
        method: request.method,
        url: request.url,
        statusCode: request.status,
        requestHeaders: safeHeaderRecord(request.headers),
        responseHeaders: request.responseHeaders ? safeHeaderRecord(request.responseHeaders) : null,
        bodyPreview: null,
        contentHash: null,
        durationMs: 0,
      })).then(() => {
        recordedRequestIds.add(request.requestId);
      })));

      const visibleRequests = inScope.map((request) => ({
        requestId: request.requestId,
        method: request.method,
        url: request.url,
        status: request.status,
        resourceType: request.resourceType ?? null,
        mimeType: request.mimeType ?? null,
        requestHeaders: safeHeaderRecord(request.headers),
        responseHeaders: request.responseHeaders ? safeHeaderRecord(request.responseHeaders) : null,
      }));
      return textResult(JSON.stringify({
        requests: visibleRequests,
        outOfScopeRequests: requests.length - inScope.length,
      }, null, 2), {
        action: "network_requests",
        requestCount: visibleRequests.length,
        recordedCount: fresh.length,
        outOfScopeRequestCount: requests.length - inScope.length,
      });
    }
    case "screenshot": {
      const filename = params.filename ?? `screenshot-${Date.now()}.png`;
      const metadata = await captureBrowserScreenshot(host, filename, signal);
      return textResult(`截图已经保存：${metadata.filename}`, {
        action: "screenshot",
        ...metadata,
      });
    }
    case "close": {
      await runAgentBrowserCommand(host.agentBrowserBin, browserCommandArgs(host, ["close", "--json"]), {
        action: "close",
        signal,
      });
      return textResult("浏览器会话已经关闭", { action: "close" });
    }
  }
}

async function captureBrowserScreenshot(
  host: SecurityToolHost,
  filename: string,
  signal: AbortSignal | undefined,
) {
  const location = {
    artifactRoot: host.artifactRoot,
    ticketId: host.ticketId,
    executionId: host.executionId,
    filename,
  };
  const storagePath = await createSecurityArtifactTarget(location);
  await runAgentBrowserCommand(host.agentBrowserBin, browserCommandArgs(host, ["screenshot", storagePath, "--json"]), {
    action: "screenshot",
    signal,
  });
  const metadata = await describeSecurityArtifact(location);
  await host.recordArtifact({ ...metadata, type: "screenshot" });
  return metadata;
}

export function closeSecurityBrowserSession(host: BrowserCommandHost): Promise<void> {
  return runAgentBrowserCommand(
    host.agentBrowserBin,
    browserCommandArgs(host, ["close", "--json"]),
    { action: "close" },
  ).then(() => undefined);
}

export function createSecurityHttpRequestTool(host: SecurityToolHost): ToolDefinition {
  return defineTool({
    name: "security_http_request",
    label: "安全 HTTP 请求",
    description: "向授权范围内的 HTTP 或 HTTPS 地址发起请求，并记录请求证据。拒绝 DELETE。",
    parameters: httpRequestParameters,
    execute: (_toolCallId, params, signal) => executeHttpRequest(host, params, signal),
  });
}

export function createSecurityBrowserTool(host: SecurityToolHost): ToolDefinition {
  const recordedRequestIds = new Set<string>();
  return defineTool({
    name: "security_browser",
    label: "安全浏览器",
    description: "通过独立 agent-browser 会话执行页面快照、点击、填充、登录、网络请求读取、截图和关闭。",
    parameters: browserParameters,
    execute: (_toolCallId, params, signal) => executeBrowserAction(host, params, signal, recordedRequestIds),
  });
}

export function createSecurityRecordFindingTool(host: SecurityToolHost): ToolDefinition {
  return defineTool({
    name: "security_record_finding",
    label: "记录安全发现",
    description: "记录带有证据、影响和修复建议的结构化安全发现。",
    parameters: findingParameters,
    execute: (_toolCallId, params: FindingParameters) => Promise.resolve(host.recordFinding(params))
      .then(() => textResult(`已经记录发现：${params.title}`, {
        fingerprint: params.fingerprint,
        severity: params.severity,
        confidence: params.confidence,
      })),
  });
}

export function createSecurityFinishTool(host: SecurityToolHost): ToolDefinition {
  return defineTool({
    name: "security_finish",
    label: "完成安全测试",
    description: "保存最终摘要、风险评分和 Markdown 报告，并结束本次安全测试。",
    promptSnippet: "保存最终摘要、风险评分和 Markdown 报告，并结束本次安全测试。",
    promptGuidelines: ["在给出最终回答之前调用 security_finish，且每次执行只调用一次。"],
    parameters: finishParameters,
    execute: (_toolCallId, params: FinishParameters) => Promise.resolve(host.finish(params))
      .then(() => ({
        ...textResult("安全测试结果已经保存", {
          riskScore: params.riskScore,
        }),
        terminate: true,
      })),
  });
}

export function createSecurityTools(host: SecurityToolHost): ToolDefinition[] {
  return [
    createSecurityHttpRequestTool(host),
    createSecurityBrowserTool(host),
    createSecurityRecordFindingTool(host),
    createSecurityFinishTool(host),
  ];
}
