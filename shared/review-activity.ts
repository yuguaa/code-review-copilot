export const reviewAgentStatuses = ['pending', 'running', 'completed', 'failed'] as const;
export const reviewActivityPhases = ['preparing', 'reviewing', 'verifying', 'completed', 'failed'] as const;

export type ReviewAgentStatus = (typeof reviewAgentStatuses)[number];
export type ReviewActivityPhase = (typeof reviewActivityPhases)[number];

export type ReviewAgentActivity = {
  id: string;
  label: string;
  provider: string;
  modelId: string;
  task: string;
  status: ReviewAgentStatus;
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
    && reviewAgentStatuses.includes(agent.status as ReviewAgentStatus);
}
