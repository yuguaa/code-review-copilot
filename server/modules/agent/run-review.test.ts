import { describe, expect, it } from 'vitest';
import { markReviewActivityFailed } from './run-review';
import { createReviewActivityState, updateReviewAgentActivity } from './review-activity';

describe('markReviewActivityFailed', () => {
  it('把不可恢复错误合并进当前审查活动，不创建第二个 run', () => {
    const state = updateReviewAgentActivity(createReviewActivityState('run-1'), {
      id: 'primary',
      label: '主审查 Agent',
      provider: 'openai',
      modelId: 'gpt-5',
      task: '正在审查',
      status: 'running',
    });

    const result = markReviewActivityFailed(state, 'Invalid JSON response');

    expect(result).toMatchObject({
      runId: 'run-1',
      phase: 'failed',
      agents: [
        { id: 'primary', status: 'failed' },
        { id: 'review-error', task: 'Invalid JSON response', status: 'failed' },
      ],
    });
  });
});
