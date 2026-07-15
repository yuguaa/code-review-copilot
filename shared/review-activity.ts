export const reviewAgentStatuses = ['pending', 'running', 'completed', 'failed'] as const;
export const reviewActivityPhases = ['preparing', 'reviewing', 'verifying', 'completed', 'failed'] as const;

export type ReviewAgentStatus = (typeof reviewAgentStatuses)[number];
export type ReviewActivityPhase = (typeof reviewActivityPhases)[number];

export const reviewAgentToolStates = ['input-available', 'output-available', 'output-error'] as const;

export type ReviewAgentToolState = (typeof reviewAgentToolStates)[number];

export type ReviewAgentToolTrace = {
  toolCallId: string;
  toolName: string;
  state: ReviewAgentToolState;
  input: string;
  errorText?: string;
};

export type ReviewAgentTraceStep = {
  id: string;
  index: number;
  text: string;
  finishReason: string;
  tools: ReviewAgentToolTrace[];
};

export type ReviewAgentTrace = {
  input: string;
  steps: ReviewAgentTraceStep[];
  output?: string;
  errorText?: string;
  truncated?: boolean;
};

export type ReviewAgentActivity = {
  id: string;
  label: string;
  provider: string;
  modelId: string;
  task: string;
  status: ReviewAgentStatus;
  trace?: ReviewAgentTrace;
  startedAt?: string;
  finishedAt?: string;
};

export type ReviewActivityState = {
  runId: string;
  phase: ReviewActivityPhase;
  agents: ReviewAgentActivity[];
};

export function isReviewActivityState(value: unknown): value is ReviewActivityState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<ReviewActivityState>;
  return typeof state.runId === 'string'
    && reviewActivityPhases.includes(state.phase as ReviewActivityPhase)
    && Array.isArray(state.agents)
    && state.agents.every(isReviewAgentActivity);
}

function isReviewAgentActivity(value: unknown): value is ReviewAgentActivity {
  if (!value || typeof value !== 'object') return false;
  const agent = value as Partial<ReviewAgentActivity>;
  return typeof agent.id === 'string'
    && typeof agent.label === 'string'
    && typeof agent.provider === 'string'
    && typeof agent.modelId === 'string'
    && typeof agent.task === 'string'
    && (agent.trace === undefined || isReviewAgentTrace(agent.trace))
    && reviewAgentStatuses.includes(agent.status as ReviewAgentStatus);
}

function isReviewAgentTrace(value: unknown): value is ReviewAgentTrace {
  if (!value || typeof value !== 'object') return false;
  const trace = value as Partial<ReviewAgentTrace>;
  return typeof trace.input === 'string'
    && Array.isArray(trace.steps)
    && trace.steps.every(isReviewAgentTraceStep)
    && (trace.output === undefined || typeof trace.output === 'string')
    && (trace.errorText === undefined || typeof trace.errorText === 'string')
    && (trace.truncated === undefined || typeof trace.truncated === 'boolean');
}

function isReviewAgentTraceStep(value: unknown): value is ReviewAgentTraceStep {
  if (!value || typeof value !== 'object') return false;
  const step = value as Partial<ReviewAgentTraceStep>;
  return typeof step.id === 'string'
    && typeof step.index === 'number'
    && Number.isInteger(step.index)
    && step.index > 0
    && typeof step.text === 'string'
    && typeof step.finishReason === 'string'
    && Array.isArray(step.tools)
    && step.tools.every(isReviewAgentToolTrace);
}

function isReviewAgentToolTrace(value: unknown): value is ReviewAgentToolTrace {
  if (!value || typeof value !== 'object') return false;
  const tool = value as Partial<ReviewAgentToolTrace>;
  return typeof tool.toolCallId === 'string'
    && typeof tool.toolName === 'string'
    && reviewAgentToolStates.includes(tool.state as ReviewAgentToolState)
    && typeof tool.input === 'string'
    && (tool.errorText === undefined || typeof tool.errorText === 'string');
}
