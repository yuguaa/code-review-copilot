import type { UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { dedupeMessages } from './chat-store';

describe('dedupeMessages', () => {
  it('keeps the last message when duplicate ids appear', () => {
    const messages: UIMessage[] = [
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: '请审查' }] },
      { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: '初始回复' }] },
      { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: '完整回复' }] },
    ];

    expect(dedupeMessages(messages)).toEqual([
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: '请审查' }] },
      { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: '完整回复' }] },
    ]);
  });

  it('drops messages without ids before persistence', () => {
    const messages = [
      { id: '', role: 'assistant', parts: [{ type: 'text', text: '缺少 id' }] },
      { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: '有效消息' }] },
    ] as UIMessage[];

    expect(dedupeMessages(messages)).toEqual([
      { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: '有效消息' }] },
    ]);
  });
});
