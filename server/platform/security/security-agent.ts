import path from "node:path";

import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";

import { securityConfig } from "@server/config/security.config";
import type { ModelConfig } from "@server/modules/ai-models/ai-models.service";

import { createSecurityModel } from "./security-model";
import { assertUrlInScope } from "./security-scope";
import {
  createSecurityTools,
  SECURITY_TOOL_NAMES,
  type SecurityArtifactRecord,
  type SecurityFindingRecord,
  type SecurityFinishRecord,
  type SecurityToolIdentity,
  type SecurityTrafficRecord,
} from "./security-tools";

export type SecurityAgentTarget = {
  name: string;
  baseUrl: string;
  scopeDomains: string[];
  authorizationOwner: string;
  authorizationReference: string;
  authorizedUntil: Date | string;
  maxDurationMinutes: number;
};

export type SecurityAgentIdentity = SecurityToolIdentity & {
  isActive?: boolean;
};

export type SecurityAgentTrafficRecord = SecurityTrafficRecord & {
  ticketId: string;
  executionId: string;
};

export type SecurityAgentArtifactRecord = SecurityArtifactRecord & {
  ticketId: string;
  executionId: string;
};

export type SecurityAgentFindingRecord = SecurityFindingRecord & {
  ticketId: string;
  executionId: string;
};

export type SecurityAgentFinishRecord = SecurityFinishRecord & {
  ticketId: string;
  executionId: string;
};

export type SecurityAgentEventRecord = {
  ticketId: string;
  executionId: string;
  type: string;
  message: string;
  data?: unknown;
};

export type SecurityAgentCallbacks = {
  recordTraffic(input: SecurityAgentTrafficRecord): Promise<void> | void;
  recordArtifact(input: SecurityAgentArtifactRecord): Promise<void> | void;
  recordFinding(input: SecurityAgentFindingRecord): Promise<void> | void;
  finish(input: SecurityAgentFinishRecord): Promise<void> | void;
  recordEvent(input: SecurityAgentEventRecord): Promise<void> | void;
};

export type CreateSecurityAgentOptions = {
  ticketId: string;
  executionId: string;
  target: SecurityAgentTarget;
  identities: SecurityAgentIdentity[];
  modelConfig: ModelConfig;
  artifactRoot: string;
  callbacks: SecurityAgentCallbacks;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type SecurityAgentResult = {
  sessionId: string;
  summary: string;
  riskScore: number;
  report: string;
};

function parseAuthorizationDeadline(value: Date | string): Date {
  const deadline = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(deadline.getTime())) throw new Error("授权截止时间格式无效");
  return deadline;
}

function abortReason(signal: AbortSignal, fallback: string): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  if (typeof reason === "string" && reason) return new Error(reason);
  return new Error(fallback);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal, "安全测试执行已经取消");
}

function lastAssistantReply(messages: AgentSession["messages"]): { text: string; stopReason: string } | null {
  const message = [...messages].reverse().find((item) => item.role === "assistant");
  if (!message || message.role !== "assistant") return null;
  const text = message.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();
  return { text, stopReason: message.stopReason };
}

function redactAgentReply(text: string, secrets: readonly string[]): string {
  return secrets.filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .reduce((result, secret) => result.split(secret).join("[REDACTED]"), text);
}

function buildSystemPrompt(): string {
  return [
    "你是授权 Web/API 安全测试执行内核。",
    "只执行当前工单授权范围内的测试，严格遵守授权截止时间和目标范围。",
    "只使用 security_http_request、security_browser、security_record_finding、security_finish 四个工具。",
    "不得输出或记录密码、API Key、Cookie 和其他凭据。",
    "所有发现必须有可复核证据。",
    "在输出任何最终结论之前，必须调用 security_finish；未调用 security_finish 的结果视为协议失败。",
  ].join("\n");
}

function buildPrompt(options: {
  ticketId: string;
  executionId: string;
  target: SecurityAgentTarget;
  scopeDomains: readonly string[];
  deadline: Date;
  identities: readonly SecurityAgentIdentity[];
  effectiveTimeoutMs: number;
}): string {
  const scope = options.scopeDomains.map((domain) => `- ${domain}`).join("\n");
  const identities = options.identities.length
    ? options.identities.map((identity) => `- ${identity.id} · ${identity.name} · ${identity.role}`).join("\n")
    : "- 无可用身份";

  return [
    "/skill:hack",
    "",
    "## 本次测试",
    `- 工单：${options.ticketId}`,
    `- 执行：${options.executionId}`,
    `- 目标：${options.target.name}`,
    `- 基址：${options.target.baseUrl}`,
    `- 授权人：${options.target.authorizationOwner}`,
    `- 授权依据：${options.target.authorizationReference}`,
    `- 授权截止：${options.deadline.toISOString()}`,
    `- 单次执行上限：${Math.ceil(options.effectiveTimeoutMs / 60_000)} 分钟`,
    "",
    "## 授权范围",
    scope,
    "",
    "## 可用身份",
    identities,
    "",
    "## 执行要求",
    "- 仅测试授权 Web/API 表面，所有 URL 必须处于授权范围。",
    "- 浏览器操作先调用 snapshot；随后根据页面和响应信号选择测试路径。",
    "- 优先证明真实影响，并保持证据可复核。",
    "- 登录只通过 identityId 和登录工具完成，禁止索取、输出或记录密码。",
    "- 禁止删除、批量写入、密码猜测、DoS、提权、横向移动、反向 Shell、EDR 规避、无线网络、AD 和二进制利用。",
    "- 每个发现调用 security_record_finding，保存结构化证据和修复建议。",
    "- 在输出最终回答之前必须调用 security_finish，保存摘要、风险评分和 Markdown 报告。",
    "- security_finish 每次执行只调用一次。",
  ].join("\n");
}

function assertTarget(options: CreateSecurityAgentOptions): {
  deadline: Date;
  scopeDomains: string[];
  effectiveTimeoutMs: number;
} {
  if (!options.ticketId.trim()) throw new Error("ticketId 不能为空");
  if (!options.executionId.trim()) throw new Error("executionId 不能为空");
  if (!options.artifactRoot.trim()) throw new Error("artifactRoot 不能为空");
  if (!Array.isArray(options.target.scopeDomains)) throw new Error("scopeDomains 必须是数组");

  const scopeDomains = options.target.scopeDomains.map((domain) => domain.trim()).filter(Boolean);
  assertUrlInScope(options.target.baseUrl, scopeDomains);
  const deadline = parseAuthorizationDeadline(options.target.authorizedUntil);
  const deadlineAvailableMs = deadline.getTime() - Date.now();
  if (deadlineAvailableMs <= 0) throw new Error("目标授权已经到期");

  const targetDurationMs = options.target.maxDurationMinutes * 60_000;
  if (!Number.isFinite(targetDurationMs) || targetDurationMs <= 0) {
    throw new Error("maxDurationMinutes 必须大于 0");
  }

  const requestedTimeoutMs = options.timeoutMs ?? targetDurationMs;
  if (!Number.isFinite(requestedTimeoutMs) || requestedTimeoutMs <= 0) {
    throw new Error("timeoutMs 必须大于 0");
  }

  return {
    deadline,
    scopeDomains,
    effectiveTimeoutMs: Math.min(requestedTimeoutMs, targetDurationMs, deadlineAvailableMs),
  };
}

/**
 * 创建并执行一次安全测试 Pi Agent。
 * 运行结束、取消、超时或失败时都会释放 AgentSession。
 */
export async function createSecurityAgent(
  options: CreateSecurityAgentOptions,
): Promise<SecurityAgentResult> {
  const { deadline, scopeDomains, effectiveTimeoutMs } = assertTarget(options);
  const controller = new AbortController();
  const forwardExternalAbort = () => controller.abort(
    options.signal?.reason ?? new Error("安全测试执行已经取消"),
  );

  if (options.signal?.aborted) forwardExternalAbort();
  else options.signal?.addEventListener("abort", forwardExternalAbort, { once: true });

  const timeoutHandle = setTimeout(
    () => controller.abort(new Error("安全测试执行超时")),
    effectiveTimeoutMs,
  );
  timeoutHandle.unref();

  let session: AgentSession | undefined;
  let unsubscribe: (() => void) | undefined;
  let abortSession: (() => void) | undefined;
  let eventError: unknown;
  let finished: SecurityFinishRecord | undefined;
  let eventQueue = Promise.resolve();
  let toolExecutionCount = 0;

  try {
    throwIfAborted(controller.signal);
    const { modelRuntime, model } = await createSecurityModel(options.modelConfig);
    throwIfAborted(controller.signal);

    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
    });
    const resourceLoader = new DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir: process.cwd(),
      settingsManager,
      additionalSkillPaths: [path.join(securityConfig.skillsRoot, "hack")],
      noExtensions: true,
      noContextFiles: true,
      noPromptTemplates: true,
      skillsOverride: (current) => ({
        skills: current.skills.filter((skill) =>
          path.resolve(skill.baseDir) === path.resolve(securityConfig.skillsRoot, "hack")),
        diagnostics: current.diagnostics,
      }),
      systemPrompt: buildSystemPrompt(),
      appendSystemPromptOverride: () => [],
    });
    await resourceLoader.reload();
    throwIfAborted(controller.signal);

    if (!resourceLoader.getSkills().skills.some((skill) => skill.name === "hack")) {
      throw new Error("hack Skill 未加载");
    }

    const browserSessionId = `security-${options.ticketId}`;
    const tools = createSecurityTools({
      ticketId: options.ticketId,
      executionId: options.executionId,
      scopeDomains,
      artifactRoot: options.artifactRoot,
      agentBrowserBin: securityConfig.agentBrowserBin,
      actionPolicyPath: securityConfig.actionPolicyPath,
      sessionId: browserSessionId,
      getIdentity: (identityId) => {
        const identity = options.identities.find((item) => item.id === identityId && item.isActive !== false);
        return Promise.resolve(identity);
      },
      recordTraffic: (input) => Promise.resolve(options.callbacks.recordTraffic({
        ...input,
        ticketId: options.ticketId,
        executionId: options.executionId,
      })),
      recordArtifact: (input) => Promise.resolve(options.callbacks.recordArtifact({
        ...input,
        ticketId: options.ticketId,
        executionId: options.executionId,
      })),
      recordFinding: (input) => Promise.resolve(options.callbacks.recordFinding({
        ...input,
        ticketId: options.ticketId,
        executionId: options.executionId,
      })),
      finish: (input) => {
        if (finished) return Promise.reject(new Error("security_finish 只允许调用一次"));
        return Promise.resolve(options.callbacks.finish({
          ...input,
          ticketId: options.ticketId,
          executionId: options.executionId,
        })).then(() => {
          finished = input;
        });
      },
    });

    const created = await createAgentSession({
      cwd: process.cwd(),
      agentDir: process.cwd(),
      modelRuntime,
      model,
      thinkingLevel: "off",
      noTools: "all",
      tools: [...SECURITY_TOOL_NAMES],
      customTools: tools,
      resourceLoader,
      sessionManager: SessionManager.inMemory(),
      settingsManager,
    });
    const activeSession = created.session;
    session = activeSession;

    const enqueueEvent = (type: string, message: string, data: Record<string, unknown>) => {
      eventQueue = eventQueue.then(() => Promise.resolve(options.callbacks.recordEvent({
        ticketId: options.ticketId,
        executionId: options.executionId,
        type,
        message,
        data,
      })));
      eventQueue.catch((error: unknown) => {
        if (eventError) return;
        eventError = error;
        controller.abort(error instanceof Error ? error : new Error("事件记录失败"));
      });
    };

    unsubscribe = activeSession.subscribe((event) => {
      if (event.type === "tool_execution_start") {
        enqueueEvent("tool.start", `工具 ${event.toolName} 开始执行`, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
        });
      } else if (event.type === "tool_execution_end") {
        toolExecutionCount += 1;
        const data = {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          durationMs: event.durationMs,
          isError: event.isError,
        };
        enqueueEvent("tool.end", `工具 ${event.toolName} 执行结束`, data);
        if (event.isError) enqueueEvent("tool.error", `工具 ${event.toolName} 执行失败`, data);
      }
    });

    abortSession = () => {
      void activeSession.abort().catch((error: unknown) => {
        if (!eventError) eventError = error;
      });
    };
    controller.signal.addEventListener("abort", abortSession, { once: true });
    if (controller.signal.aborted) abortSession();
    throwIfAborted(controller.signal);

    const prompt = buildPrompt({
      ticketId: options.ticketId,
      executionId: options.executionId,
      target: options.target,
      scopeDomains,
      deadline,
      identities: options.identities,
      effectiveTimeoutMs,
    });

    let promptError: unknown;
    const runPrompt = (value: string) => activeSession.prompt(value).catch((error: unknown) => {
      promptError = error;
    }).then(() => eventQueue.catch((error: unknown) => {
      if (!eventError) eventError = error;
    }));
    const recordAgentReply = (message: string) => {
      const reply = lastAssistantReply(activeSession.messages);
      if (!reply?.text) return Promise.resolve();
      return Promise.resolve(options.callbacks.recordEvent({
        ticketId: options.ticketId,
        executionId: options.executionId,
        type: "agent.message",
        message,
        data: {
          stopReason: reply.stopReason,
          text: redactAgentReply(
            reply.text.slice(0, 4000),
            [options.modelConfig.apiKey, ...options.identities.map((identity) => identity.password)],
          ),
        },
      }));
    };

    await runPrompt(prompt);
    await recordAgentReply("Agent 第一轮回复");
    if (!promptError && !eventError && !finished) {
      await runPrompt([
        "协议未完成：上一轮回复没有调用 security_finish。",
        "现在必须调用 security_finish，保存摘要、风险评分和 Markdown 报告。",
        "不要在调用 security_finish 之前输出最终回答。",
      ].join("\n"));
      await recordAgentReply("Agent 协议补全回复");
    }

    if (eventError) throw eventError;
    if (promptError) throw promptError;
    throwIfAborted(controller.signal);
    if (!finished) {
      if (!toolExecutionCount) throw new Error("Agent 未执行任何安全测试工具");
      const reply = lastAssistantReply(activeSession.messages);
      const warning = "Agent 未调用 security_finish，运行时已根据已保存的流量、发现和证据生成报告";
      await options.callbacks.recordEvent({
        ticketId: options.ticketId,
        executionId: options.executionId,
        type: "agent.protocol-warning",
        message: warning,
        data: {
          toolExecutionCount,
          stopReason: reply?.stopReason ?? "unknown",
        },
      });
      const replyText = reply?.text.trim();
      finished = {
        summary: replyText
          ? `已完成安全测试工具执行：${replyText.split("\n")[0].slice(0, 200)}`
          : "已完成安全测试工具执行，报告由运行时根据证据生成",
        riskScore: 0,
        report: `${warning}\n\n${replyText || "Agent 没有返回文字说明，详细结果见结构化发现、流量和证据记录。"}`,
      };
    }

    return {
      sessionId: activeSession.sessionId,
      summary: finished.summary,
      riskScore: finished.riskScore,
      report: finished.report,
    };
  } finally {
    unsubscribe?.();
    if (abortSession) controller.signal.removeEventListener("abort", abortSession);
    options.signal?.removeEventListener("abort", forwardExternalAbort);
    clearTimeout(timeoutHandle);
    session?.dispose();
  }
}
