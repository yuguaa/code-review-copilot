import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { prepareChatMessages, shouldUseChatTools } from './review-agent';

describe('chat mode message preparation', () => {
  it('drops the webhook seed and keeps the latest natural-language question', () => {
    const messages: UIMessage[] = [
      {
        id: 'seed',
        role: 'user',
        parts: [{ type: 'text', text: '请审查本次 Push。工作区已就绪，当前目录即仓库根。\n- 分支：main' }],
      },
      { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: '审查完成。' }] },
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: '你好' }] },
    ];

    expect(prepareChatMessages(messages)).toEqual([
      { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: '审查完成。' }] },
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: '你好' }] },
    ]);
  });

  it('does not enable tools for greetings', () => {
    expect(shouldUseChatTools([{ id: 'u1', role: 'user', parts: [{ type: 'text', text: '你好' }] }])).toBe(false);
    expect(shouldUseChatTools([{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }])).toBe(false);
  });

  it('enables read tools only when the latest question needs code context', () => {
    expect(
      shouldUseChatTools([{ id: 'u1', role: 'user', parts: [{ type: 'text', text: '这个改动有什么风险' }] }]),
    ).toBe(true);
  });
});
