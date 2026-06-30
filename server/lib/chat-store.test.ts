import type { UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { dedupeMessages, mergeStreamingMessage } from './chat-store';

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

describe('mergeStreamingMessage', () => {
  it('replaces the last assistant message when a streamed update uses the same id', () => {
    const baseMessages: UIMessage[] = [
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: '继续解释' }] },
      { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: '旧内容' }] },
    ];
    const streamingMessage: UIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: '流式新内容' }],
    };

    expect(mergeStreamingMessage(baseMessages, streamingMessage)).toEqual([
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: '继续解释' }] },
      { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: '流式新内容' }] },
    ]);
  });
});
