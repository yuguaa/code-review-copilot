import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { ensureVisibleAssistantReply } from './review-message';

describe('ensureVisibleAssistantReply', () => {
  it('最新用户消息后已有 assistant 文本时不追加消息', () => {
    const messages: UIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: '请审查' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: '审查完成。' }] },
    ];

    expect(ensureVisibleAssistantReply(messages)).toBe(messages);
  });

  it('历史 assistant 文本不能抵消本轮用户追问', () => {
    const messages: UIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: '请审查' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: '审查完成。' }] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: '这个项目是做什么的' }] },
    ];

    const result = ensureVisibleAssistantReply(messages);
    expect(result).toHaveLength(4);
    expect(result[3].role).toBe('assistant');
    expect(result[3].parts).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('本轮模型没有返回可展示的文本结果') }),
    ]);
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
      expect.objectContaining({ type: 'text', text: expect.stringContaining('本轮模型没有返回可展示的文本结果') }),
    ]);
  });
});
