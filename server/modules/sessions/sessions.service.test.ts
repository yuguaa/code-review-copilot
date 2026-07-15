import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  publishSessionListChanged: vi.fn(),
  publishSessionMessages: vi.fn(),
  setActiveMessage: vi.fn(),
}));

vi.mock('../agent/run-review', () => ({
  runReviewSession: vi.fn(),
  stopRunningReviewSession: vi.fn(),
}));
vi.mock('./session-message-store.service', () => ({
  getSessionWithRepository: vi.fn(),
  listSessions: vi.fn(),
  loadSessionMessageTree: vi.fn(),
  messageFeedbackValues: ['up', 'down'],
  setActiveMessage: mocks.setActiveMessage,
  setMessageFeedback: vi.fn(),
}));
vi.mock('../../infrastructure/prisma/prisma.service', () => ({ prisma: {} }));
vi.mock('./session-events.service', () => ({
  publishSessionListChanged: mocks.publishSessionListChanged,
  publishSessionMessages: mocks.publishSessionMessages,
}));
vi.mock('./session-lifecycle.service', () => ({
  markReviewSessionRunning: vi.fn(),
  markReviewSessionStopped: vi.fn(),
  STOPPED_REVIEW_ERROR: '用户手动停止审查',
}));

import { switchActiveMessage } from './sessions.service';

const tree = {
  messages: [],
  messageTree: [],
  activeLeafMessageId: 'message-2',
  activePathIds: ['message-1', 'message-2'],
};

describe('switchActiveMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('切换成功后广播权威消息树', async () => {
    mocks.setActiveMessage.mockResolvedValue(tree);

    await expect(switchActiveMessage('session-1', 'message-2')).resolves.toBe(tree);

    expect(mocks.publishSessionMessages).toHaveBeenCalledWith('session-1', tree);
    expect(mocks.publishSessionListChanged).toHaveBeenCalledOnce();
  });

  it('目标消息不存在时不广播', async () => {
    mocks.setActiveMessage.mockResolvedValue(null);

    await expect(switchActiveMessage('session-1', 'missing')).resolves.toBeNull();

    expect(mocks.publishSessionMessages).not.toHaveBeenCalled();
    expect(mocks.publishSessionListChanged).not.toHaveBeenCalled();
  });
});
