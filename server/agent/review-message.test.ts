import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { ensureVisibleAssistantReply } from './review-message';

describe('ensureVisibleAssistantReply', () => {
  it('已有 assistant 文本时不追加消息', () => {
    const messages: UIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: '请审查' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: '审查完成。' }] },
    ];

    expect(ensureVisibleAssistantReply(messages)).toBe(messages);
  });

  it('只有事件没有文本时追加可见 assistant 回复', () => {
    const messages: UIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: '请审查' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'step-start' }] } as UIMessage,
    ];

    const result = ensureVisibleAssistantReply(messages);
    expect(result).toHaveLength(3);
    expect(result[2].role).toBe('assistant');
    expect(result[2].parts).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('模型没有返回可展示的文本结果') }),
    ]);
  });
});
