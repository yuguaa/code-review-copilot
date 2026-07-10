import type { UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import {
  createReviewActivityState,
  failRunningReviewAgents,
  updateReviewAgentActivity,
  upsertReviewActivityMessage,
} from './review-activity';

const primary = {
  id: 'primary',
  label: '主审查 Agent',
  provider: 'openai',
  modelId: 'gpt-5',
  task: '分析变更并取证',
  status: 'running' as const,
};

describe('review activity', () => {
  it('把活动面板插在本轮用户消息和正文回复之间', () => {
    const messages: UIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: '请审查' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: '正文' }] },
    ];
    const state = updateReviewAgentActivity(createReviewActivityState('run-1'), primary, '2026-07-10T00:00:00.000Z');

    expect(upsertReviewActivityMessage(messages, state).map((message) => message.id)).toEqual([
      'u1',
      'review-activity-run-1',
      'a1',
    ]);
  });

  it('同一 Agent 更新时不重复追加，并保留开始时间', () => {
    const running = updateReviewAgentActivity(createReviewActivityState('run-1'), primary, '2026-07-10T00:00:00.000Z');
    const completed = updateReviewAgentActivity(
      running,
      { ...primary, task: '主审查完成', status: 'completed' },
      '2026-07-10T00:01:00.000Z',
    );

    expect(completed.agents).toHaveLength(1);
    expect(completed.agents[0]).toMatchObject({
      status: 'completed',
      startedAt: '2026-07-10T00:00:00.000Z',
      finishedAt: '2026-07-10T00:01:00.000Z',
    });
  });

  it('失败时终止仍在运行的 Agent', () => {
    const running = updateReviewAgentActivity(createReviewActivityState('run-1'), primary);
    expect(failRunningReviewAgents(running)).toMatchObject({
      phase: 'failed',
      agents: [{ id: 'primary', status: 'failed' }],
    });
  });
});
