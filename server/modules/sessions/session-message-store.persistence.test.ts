import type { UIMessage } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  messageUpdateMany: vi.fn(),
  sessionUpdate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../infrastructure/prisma/prisma.service', () => ({
  prisma: { $transaction: mocks.transaction },
}));

import { updatePersistedMessageParts } from './session-message-store.service';

const activityMessage: UIMessage = {
  id: 'review-activity-run-1',
  role: 'assistant',
  parts: [{ type: 'data-review-activity', data: { runId: 'run-1', phase: 'reviewing', agents: [] } } as never],
};

describe('updatePersistedMessageParts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.messageUpdateMany.mockResolvedValue({ count: 1 });
    mocks.sessionUpdate.mockResolvedValue({ id: 'session-1' });
    mocks.transaction.mockImplementation((operation) => operation({
      message: { updateMany: mocks.messageUpdateMany },
      session: { update: mocks.sessionUpdate },
    }));
  });

  it('只更新目标会话中的活动消息，并刷新会话更新时间', async () => {
    await expect(updatePersistedMessageParts('session-1', activityMessage)).resolves.toBeUndefined();

    expect(mocks.messageUpdateMany).toHaveBeenCalledWith({
      where: { id: activityMessage.id, sessionId: 'session-1' },
      data: { parts: activityMessage.parts },
    });
    expect(mocks.sessionUpdate).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it('活动消息尚未落库时中止事务', async () => {
    mocks.messageUpdateMany.mockResolvedValue({ count: 0 });

    await expect(updatePersistedMessageParts('session-1', activityMessage)).rejects.toThrow(
      `待更新消息不存在：${activityMessage.id}`,
    );
    expect(mocks.sessionUpdate).not.toHaveBeenCalled();
  });
});
