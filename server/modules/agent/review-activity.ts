import type { UIMessage } from 'ai';
import type {
  ReviewAgentActivity,
  ReviewActivityPhase,
  ReviewActivityState,
} from '@shared/review-activity';

export type {
  ReviewAgentActivity,
  ReviewAgentStatus,
  ReviewActivityPhase,
  ReviewActivityState,
} from '@shared/review-activity';

export type ReviewAgentActivityUpdate = Omit<ReviewAgentActivity, 'startedAt' | 'finishedAt'>;
export type ReviewActivityReporter = (
  update: ReviewAgentActivityUpdate,
  phase?: ReviewActivityPhase,
) => void;

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
  const current = state.agents.find((agent) => agent.id === update.id);
  const next: ReviewAgentActivity = {
    ...current,
    ...update,
    startedAt: current?.startedAt ?? (update.status === 'pending' ? undefined : now),
    finishedAt: update.status === 'completed' || update.status === 'failed' ? now : undefined,
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
    phase: 'failed',
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
