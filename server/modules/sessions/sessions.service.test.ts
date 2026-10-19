import { describe, expect, it } from 'vitest';

import { claimChatSession, isChatSessionActive } from '@server/platform/chat/chat-runtime';
import { isSessionBusy } from './session-lifecycle.service';

describe('会话执行互斥', () => {
  it.each(['queued', 'running', 'cancelling'])('%s 阻止修改会话', (status) => {
    expect(isSessionBusy(status)).toBe(true);
  });

  it.each(['completed', 'partial', 'failed', 'cancelled', 'interrupted'])('%s 允许新操作', (status) => {
    expect(isSessionBusy(status)).toBe(false);
  });

  it('同一会话仅有一个聊天生成，结束后释放资格', () => {
    const release = claimChatSession('chat-lock');
    expect(isChatSessionActive('chat-lock')).toBe(true);
    expect(() => claimChatSession('chat-lock')).toThrow('正在生成回答');
    expect(isChatSessionActive('other-chat')).toBe(false);
    release();
    release();
    expect(isChatSessionActive('chat-lock')).toBe(false);
    const nextRelease = claimChatSession('chat-lock');
    release();
    expect(isChatSessionActive('chat-lock')).toBe(true);
    nextRelease();
  });
});
