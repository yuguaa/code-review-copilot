import type { UIMessage } from 'ai';
import type {
  ReviewAgentActivity,
  ReviewAgentTrace,
  ReviewAgentToolTrace,
  ReviewActivityPhase,
  ReviewActivityState,
} from '@shared/review-activity';

export type {
  ReviewAgentActivity,
  ReviewAgentTrace,
  ReviewAgentStatus,
  ReviewActivityPhase,
  ReviewActivityState,
} from '@shared/review-activity';

export type ReviewAgentActivityUpdate = Omit<ReviewAgentActivity, 'startedAt' | 'finishedAt'>;
export type ReviewActivityReporter = (
  update: ReviewAgentActivityUpdate,
  phase?: ReviewActivityPhase,
) => void;

export type ReviewAgentTraceStepSource = {
  callId: string;
  stepNumber: number;
  text: string;
  finishReason: string;
  content: ReadonlyArray<{
    type: string;
    toolCallId?: string;
    error?: unknown;
  }>;
  toolCalls: ReadonlyArray<{
    toolCallId: string;
    toolName: string;
    input: unknown;
  } | undefined>;
  toolResults: ReadonlyArray<{
    toolCallId: string;
    output: unknown;
  } | undefined>;
};

const TRACE_MAX_STEPS = 32;
const TRACE_MAX_TOOLS_PER_STEP = 8;
const TRACE_MAX_TOTAL_CHARS = 64_000;
const TRACE_MAX_STEPS_CHARS = 32_000;
const TRACE_MAX_INPUT_CHARS = 2_000;
const TRACE_MAX_TEXT_CHARS = 6_000;
const TRACE_MAX_RESULT_CHARS = 30_000;
const TRACE_MAX_ERROR_CHARS = 1_000;
const REVIEW_MAX_TRACE_AGENTS = 16;
const REVIEW_MAX_AGENTS = 32;
const TRACE_OVERFLOW_AGENT_ID = 'trace-overflow';
const REDACTED = '[已脱敏]';

const SENSITIVE_KEY_SOURCE = String.raw`api[ _-]?key|account[ _-]?key|access[ _-]?token|authorization|ocp[ _-]apim[ _-]subscription[ _-]key|x[ _-]functions[ _-]key|password|passwd|secret|token|credential|connection[ _-]?string|shared[ _-]?access[ _-]?signature|signature|cookie|private[ _-]?key|client[ _-]?secret`;
const sensitiveKeyPattern = new RegExp(`(?:${SENSITIVE_KEY_SOURCE})`, 'i');
const exactSensitiveKeyPattern = /^(?:_?auth|sig)$/i;
const sensitiveAssignmentPattern = new RegExp(
  `((?:"|')?(?:${SENSITIVE_KEY_SOURCE}|_?auth|sig)(?:"|')?\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,}\\r\\n]+)`,
  'gi',
);
const sensitiveHeaderPattern = /((?:"|')?(?:(?:proxy-)?authorization|cookie|set-cookie|ocp-apim-subscription-key|x-functions-key|x-api-key|x-auth-token)(?:"|')?\s*:\s*)(?:"[^"]*"|'[^']*'|[^\r\n]+)/gi;

function traceText(value: unknown, maxChars: number): { text: string; truncated: boolean } {
  let raw: string;
  if (typeof value === 'string') {
    raw = value;
  } else {
    try {
      raw = JSON.stringify(
        value,
        (key, entry) => sensitiveKeyPattern.test(key) || exactSensitiveKeyPattern.test(key) ? REDACTED : entry,
        2,
      ) ?? String(value);
    } catch {
      raw = String(value);
    }
  }

  const sanitized = raw
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, REDACTED)
    .replace(sensitiveHeaderPattern, `$1${REDACTED}`)
    .replace(/\bBasic\s+[A-Za-z0-9+/=]+/gi, `Basic ${REDACTED}`)
    .replace(/\bBearer\s+[^\s"']+/gi, `Bearer ${REDACTED}`)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, REDACTED)
    .replace(/\b(?:(?:sk|rk)_(?:live|test)_|whsec_)[A-Za-z0-9]{16,}\b/g, REDACTED)
    .replace(/\b(?:glpat-|github_pat_|gh[pousr]_|sk-|npm_|xox[baprs]-|ya29\.)[A-Za-z0-9_.-]{10,}\b/g, REDACTED)
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, REDACTED)
    .replace(sensitiveAssignmentPattern, `$1${REDACTED}`)
    .replace(/(^|\n)(\s*(?:export\s+)?[A-Z0-9_]*(?:TOKEN|CREDENTIAL|CONNECTION_STRING|SIGNATURE|API_KEY|ACCOUNT_KEY|ACCESS_KEY(?:_ID)?|AUTHORIZATION|PASSWORD|PASSWD|SECRET|COOKIE|PRIVATE_KEY|CLIENT_SECRET)[A-Z0-9_]*\s*=\s*)[^\r\n]*/gi, `$1$2${REDACTED}`)
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, `$1${REDACTED}@`);

  if (sanitized.length <= maxChars) return { text: sanitized, truncated: false };
  return {
    text: `${sanitized.slice(0, maxChars)}\n…（内容已截断，共 ${sanitized.length} 字符）`,
    truncated: true,
  };
}

export function sanitizeReviewAgentText(value: unknown): string {
  return traceText(value, TRACE_MAX_TEXT_CHARS).text;
}

function projectReviewAgentResult(value: unknown) {
  return traceText(value, TRACE_MAX_RESULT_CHARS);
}

export function sanitizeReviewAgentResult(value: unknown): string {
  return projectReviewAgentResult(value).text;
}

function traceSize(trace: ReviewAgentTrace): number {
  return JSON.stringify(trace).length;
}

export function createReviewAgentTrace(input: string): ReviewAgentTrace {
  const projected = traceText(input, TRACE_MAX_TEXT_CHARS);
  return { input: projected.text, steps: [], ...(projected.truncated ? { truncated: true } : {}) };
}

export function completeReviewAgentTrace(trace: ReviewAgentTrace, result: unknown): ReviewAgentTrace {
  const projected = projectReviewAgentResult(result);
  const completed = {
    ...trace,
    output: projected.text,
    ...((trace.truncated || projected.truncated) ? { truncated: true } : {}),
  };
  if (traceSize(completed) <= TRACE_MAX_TOTAL_CHARS) return completed;

  const suffix = '\n…（输出已按轨迹体积上限截断）';
  let low = 0;
  let high = projected.text.length;
  while (low < high) {
    const length = Math.ceil((low + high) / 2);
    const candidate = { ...trace, output: `${projected.text.slice(0, length)}${suffix}`, truncated: true };
    if (traceSize(candidate) <= TRACE_MAX_TOTAL_CHARS) low = length;
    else high = length - 1;
  }
  const output = `${projected.text.slice(0, low)}${suffix}`;
  return traceSize({ ...trace, output, truncated: true }) <= TRACE_MAX_TOTAL_CHARS
    ? { ...trace, output, truncated: true }
    : { ...trace, truncated: true };
}

export function appendReviewAgentTraceStep(
  trace: ReviewAgentTrace,
  step: ReviewAgentTraceStepSource,
): ReviewAgentTrace {
  if (trace.steps.length >= TRACE_MAX_STEPS || traceSize(trace) >= TRACE_MAX_STEPS_CHARS) {
    return trace.truncated ? trace : { ...trace, truncated: true };
  }
  const completedToolCalls = new Set(
    step.toolResults.flatMap((result) => result ? [result.toolCallId] : []),
  );
  const errors = new Map(
    step.content.flatMap((part) =>
      part.type === 'tool-error' && part.toolCallId
        ? [[part.toolCallId, part.error] as const]
        : [],
    ),
  );
  let truncated = trace.truncated === true || step.toolCalls.length > TRACE_MAX_TOOLS_PER_STEP;
  const tools: ReviewAgentToolTrace[] = step.toolCalls
    .filter((call): call is NonNullable<typeof call> => Boolean(call))
    .slice(0, TRACE_MAX_TOOLS_PER_STEP)
    .map((call): ReviewAgentToolTrace => {
      const error = errors.get(call.toolCallId);
      const input = traceText(call.input, TRACE_MAX_INPUT_CHARS);
      truncated ||= input.truncated;
      if (error !== undefined) {
        const errorText = traceText(reviewAgentErrorText(error), TRACE_MAX_ERROR_CHARS);
        truncated ||= errorText.truncated;
        return {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          state: 'output-error',
          input: input.text,
          errorText: errorText.text,
        };
      }
      if (completedToolCalls.has(call.toolCallId)) {
        return {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          state: 'output-available',
          input: input.text,
        };
      }
      return {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        state: 'input-available',
        input: input.text,
      };
    });

  const text = traceText(step.text, TRACE_MAX_TEXT_CHARS);
  truncated ||= text.truncated;
  const next: ReviewAgentTrace = {
    ...trace,
    steps: [
      ...trace.steps,
      {
        id: `${step.callId}:${step.stepNumber}`,
        index: trace.steps.length + 1,
        text: text.text,
        finishReason: step.finishReason,
        tools,
      },
    ],
    ...(truncated ? { truncated: true } : {}),
  };
  if (traceSize(next) <= TRACE_MAX_STEPS_CHARS) return next;
  return trace.truncated ? trace : { ...trace, truncated: true };
}

export function failReviewAgentTrace(trace: ReviewAgentTrace, errorText: string): ReviewAgentTrace {
  const projected = traceText(errorText, TRACE_MAX_ERROR_CHARS);
  const failedTrace = { ...trace };
  delete failedTrace.output;
  return {
    ...failedTrace,
    errorText: projected.text,
    ...(projected.truncated ? { truncated: true } : {}),
  };
}

function reviewAgentErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createReviewActivityState(runId: string): ReviewActivityState {
  return { runId, phase: 'preparing', agents: [] };
}

export function setReviewActivityPhase(state: ReviewActivityState, phase: ReviewActivityPhase): ReviewActivityState {
  return { ...state, phase };
}

export function updateReviewAgentActivity(
  state: ReviewActivityState,
  update: ReviewAgentActivityUpdate,
  now = new Date().toISOString(),
): ReviewActivityState {
  const safeUpdate = { ...update, task: sanitizeReviewAgentText(update.task) };
  const current = state.agents.find((agent) => agent.id === update.id);
  if (!current && safeUpdate.trace && state.agents.filter((agent) => agent.trace).length >= REVIEW_MAX_TRACE_AGENTS) {
    const overflow = state.agents.find((agent) => agent.id === TRACE_OVERFLOW_AGENT_ID);
    if (overflow || state.agents.length >= REVIEW_MAX_AGENTS) return state;
    return {
      ...state,
      agents: [
        ...state.agents,
        {
          id: TRACE_OVERFLOW_AGENT_ID,
          label: '更多专项 Agent',
          provider: 'system',
          modelId: 'runtime',
          task: `本轮已达到 ${REVIEW_MAX_TRACE_AGENTS} 个可记录 Agent 的安全上限，其余轨迹不再持久化。`,
          status: 'completed',
          startedAt: now,
          finishedAt: now,
        },
      ],
    };
  }
  if (!current && state.agents.length >= REVIEW_MAX_AGENTS) return state;
  const next: ReviewAgentActivity = {
    ...current,
    ...safeUpdate,
    startedAt: current?.startedAt ?? (safeUpdate.status === 'pending' ? undefined : now),
    finishedAt: safeUpdate.status === 'completed' || safeUpdate.status === 'failed' ? now : undefined,
  };
  const agents = current
    ? state.agents.map((agent) => (agent.id === update.id ? next : agent))
    : [...state.agents, next];
  return { ...state, agents };
}

export function failRunningReviewAgents(state: ReviewActivityState): ReviewActivityState {
  const now = new Date().toISOString();
  return {
    ...state,
    agents: state.agents.map((agent) =>
      agent.status === 'running' || agent.status === 'pending'
        ? { ...agent, status: 'failed', finishedAt: now }
        : agent,
    ),
  };
}

export function reviewActivityMessage(state: ReviewActivityState): UIMessage {
  return {
    id: `review-activity-${state.runId}`,
    role: 'assistant',
    parts: [
      {
        type: 'data-review-activity',
        data: state,
      } as UIMessage['parts'][number],
    ],
  };
}

/** 活动面板固定插在本轮最后一条用户消息之后，正文流保持在其后。 */
export function upsertReviewActivityMessage(messages: UIMessage[], state: ReviewActivityState): UIMessage[] {
  const next = reviewActivityMessage(state);
  const currentIndex = messages.findIndex((message) => message.id === next.id);
  if (currentIndex >= 0) {
    return messages.map((message, index) => (index === currentIndex ? next : message));
  }

  const latestUserIndex = messages.findLastIndex((message) => message.role === 'user');
  const insertAt = latestUserIndex >= 0 ? latestUserIndex + 1 : messages.length;
  return [...messages.slice(0, insertAt), next, ...messages.slice(insertAt)];
}
