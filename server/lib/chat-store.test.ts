import type { UIMessage } from 'ai';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dedupeMessages, mergeIncomingUserMessage, mergePersistedMessages, mergeStreamingMessage } from './chat-store';

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

  it('补齐无 id 消息，避免持久化时丢回答', () => {
    const messages = [
      { id: '', role: 'assistant', parts: [{ type: 'text', text: '缺少 id' }] },
      { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: '有效消息' }] },
    ] as UIMessage[];

    const result = dedupeMessages(messages);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBeTruthy();
    expect(result[0].parts).toEqual([{ type: 'text', text: '缺少 id' }]);
    expect(result[1]).toEqual({ id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: '有效消息' }] });
  });
});

describe('mergePersistedMessages', () => {
  it('流结束回调只返回本轮消息时保留历史回答', () => {
    const storedMessages: UIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: '请审查' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: '历史回答' }] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: '继续追问' }] },
    ];
    const finalMessages: UIMessage[] = [
      { id: 'a2', role: 'assistant', parts: [{ type: 'text', text: '追问回答' }] },
    ];

    expect(mergePersistedMessages(storedMessages, finalMessages).map((message) => message.id)).toEqual([
      'u1',
      'a1',
      'u2',
      'a2',
    ]);
  });

  it('相同 id 的最终消息覆盖历史占位消息', () => {
    const storedMessages: UIMessage[] = [
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: '旧内容' }] },
    ];
    const finalMessages: UIMessage[] = [
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: '完整内容' }] },
    ];

    expect(mergePersistedMessages(storedMessages, finalMessages)).toEqual(finalMessages);
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

describe('mergeIncomingUserMessage', () => {
  it('以数据库历史为事实源，只追加请求里的最新用户消息', () => {
    const storedMessages: UIMessage[] = [
      { id: 'seed', role: 'user', parts: [{ type: 'text', text: '请审查' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: '审查完成' }] },
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: '第一个追问' }] },
      { id: 'a2', role: 'assistant', parts: [{ type: 'text', text: '第一个回答' }] },
    ];
    const incomingMessages: UIMessage[] = [
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: '第二个追问' }] },
    ];

    expect(mergeIncomingUserMessage(storedMessages, incomingMessages).map((message) => message.id)).toEqual([
      'seed',
      'a1',
      'u1',
      'a2',
      'u2',
    ]);
  });

  it('请求里的最新用户消息已存在时不重复追加', () => {
    const storedMessages: UIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: '第一个追问' }] },
    ];

    expect(mergeIncomingUserMessage(storedMessages, storedMessages)).toEqual(storedMessages);
  });
});

describe('listSessions', () => {
  it('侧栏会话列表按最近活动时间排序', () => {
    const source = readFileSync(new URL('./chat-store.ts', import.meta.url), 'utf8');
    const listSessionsBlock = source.slice(source.indexOf('export async function listSessions'), source.indexOf('/** 从首条用户消息抽取'));

    expect(listSessionsBlock).toContain("orderBy: { updatedAt: 'desc' }");
    expect(listSessionsBlock).toContain("messages: { orderBy: { createdAt: 'desc' }, take: 1 }");
  });
});
