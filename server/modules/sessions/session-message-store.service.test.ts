import type { UIMessage } from 'ai';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyMessageFeedback,
  buildThresholdFeedbackMemorySection,
  buildPathIds,
  buildSiblingIdsByParent,
  collectFeedbackStats,
  dedupeMessages,
  feedbackPatternOf,
  mergeThresholdFeedbackMemory,
  mergeIncomingUserMessage,
  mergeIncomingUserMessageAtParent,
  mergePersistedMessages,
  mergeStreamingMessage,
  pickActiveLeafId,
  pickLatestLeafId,
  type MessageRow,
} from './session-message-store.service';

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

describe('message feedback helpers', () => {
  it('把反馈写到 assistant 文本 part 上', () => {
    const parts = [
      { type: 'text', text: '发现一个问题' },
      { type: 'tool-bash', state: 'output-available' },
    ];

    const result = applyMessageFeedback(parts, 'up');

    expect(result[0]).toMatchObject({ type: 'text', text: '发现一个问题', feedback: 'up' });
    expect((result[0] as { feedbackAt?: string }).feedbackAt).toBeTruthy();
    expect(result[1]).toEqual(parts[1]);
  });

  it('把单条发现反馈写到文本 part 的 findingFeedbacks 上', () => {
    const parts = [
      { type: 'text', text: '## 严重\n- 文件:a.ts:1 问题：空指针 影响：崩溃 修复建议：判空' },
    ];

    const result = applyMessageFeedback(parts, 'down', '文件:a.ts:1 问题：空指针 影响：崩溃 修复建议：判空');

    expect(result[0]).toMatchObject({
      type: 'text',
      findingFeedbacks: [
        {
          text: '文件:a.ts:1 问题：空指针 影响：崩溃 修复建议：判空',
          feedback: 'down',
        },
      ],
    });
  });

  it('同一问题同时存在于草稿和 Verify 时只更新最终 Verify part', () => {
    const finding = 'a.ts:1 问题：空指针 影响：崩溃 修复建议：判空';
    const parts = [
      { type: 'text', text: `## 严重\n- ${finding}` },
      { type: 'text', text: `## Verify 结论\n## 严重\n1. ${finding}` },
    ];

    const result = applyMessageFeedback(parts, 'up', finding);

    expect(result[0]).not.toHaveProperty('findingFeedbacks');
    expect(result[1]).toMatchObject({
      findingFeedbacks: [{ text: finding, feedback: 'up' }],
    });
  });

  it('找不到对应问题时不把反馈写入无关文本', () => {
    const parts = [{ type: 'text', text: '## Verify 结论\n未发现问题' }];

    expect(applyMessageFeedback(parts, 'down', 'a.ts:1 不存在的问题')).toEqual(parts);
  });

  it('按问题模式归一化反馈文本', () => {
    expect(feedbackPatternOf('server/a.ts:10 问题：空指针 影响：运行崩溃 修复建议：增加判空')).toBe('空指针');
    expect(feedbackPatternOf('- web/b.tsx:2 重复请求会浪费资源')).toBe('重复请求会浪费资源');
  });

  it('未达到阈值时不写入长期记忆', () => {
    const stats = collectFeedbackStats([
      [{ type: 'text', findingFeedbacks: [{ text: 'a.ts:1 问题：空指针', feedback: 'up' }] }],
      [{ type: 'text', findingFeedbacks: [{ text: 'b.ts:2 问题：空指针', feedback: 'up' }] }],
    ]);
    const section = buildThresholdFeedbackMemorySection(stats);

    expect(section).toBe('## 用户反馈阈值沉淀');
    expect(mergeThresholdFeedbackMemory('## 架构约定\n- 使用 Hono', section)).toBe('## 架构约定\n- 使用 Hono');
  });

  it('3 次反馈且净赞成达到 2 时写入认可模式', () => {
    const stats = collectFeedbackStats([
      [{ type: 'text', findingFeedbacks: [{ text: 'a.ts:1 问题：空指针', feedback: 'up' }] }],
      [{ type: 'text', findingFeedbacks: [{ text: 'b.ts:2 问题：空指针', feedback: 'up' }] }],
      [{ type: 'text', findingFeedbacks: [{ text: 'c.ts:3 问题：空指针', feedback: 'down' }] }],
      [{ type: 'text', findingFeedbacks: [{ text: 'd.ts:4 问题：空指针', feedback: 'up' }] }],
    ]);

    expect(buildThresholdFeedbackMemorySection(stats)).toContain('用户认可的问题模式：空指针（赞 3 / 踩 1 / 净 2）');
  });

  it('3 次反馈且净反对达到 2 时写入否定模式', () => {
    const stats = collectFeedbackStats([
      [{ type: 'text', findingFeedbacks: [{ text: 'a.ts:1 问题：误报鉴权', feedback: 'down' }] }],
      [{ type: 'text', findingFeedbacks: [{ text: 'b.ts:2 问题：误报鉴权', feedback: 'down' }] }],
      [{ type: 'text', findingFeedbacks: [{ text: 'c.ts:3 问题：误报鉴权', feedback: 'up' }] }],
      [{ type: 'text', findingFeedbacks: [{ text: 'd.ts:4 问题：误报鉴权', feedback: 'down' }] }],
    ]);

    expect(buildThresholdFeedbackMemorySection(stats)).toContain('用户否定的问题模式：误报鉴权（赞 1 / 踩 3 / 净 -2）');
  });

  it('同一发现切换反馈时只保留当前反馈', () => {
    const first = applyMessageFeedback(
      [{ type: 'text', text: '## 严重\n- a.ts:1 问题：空指针' }],
      'up',
      'a.ts:1 问题：空指针',
    );
    const switched = applyMessageFeedback(first, 'down', 'a.ts:1 问题：空指针');
    const stats = collectFeedbackStats([switched]);

    expect(stats).toEqual([{ pattern: '空指针', up: 0, down: 1 }]);
  });

  it('更新阈值沉淀分组时保留其它记忆分组', () => {
    const section = '## 用户反馈阈值沉淀\n- 用户认可的问题模式：空指针（赞 3 / 踩 1 / 净 2）';

    expect(mergeThresholdFeedbackMemory('## 架构约定\n- 使用 Hono\n\n## 用户反馈沉淀\n- 单次旧反馈\n\n## 用户反馈阈值沉淀\n- 旧内容', section)).toBe(
      '## 架构约定\n- 使用 Hono\n\n## 用户反馈阈值沉淀\n- 用户认可的问题模式：空指针（赞 3 / 踩 1 / 净 2）',
    );
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

describe('message tree helpers', () => {
  const at = (n: number) => new Date(2026, 0, 1, 0, 0, n);
  const rows: MessageRow[] = [
    { id: 'u1', parentId: null, role: 'user', parts: [], createdAt: at(1) },
    { id: 'a1', parentId: 'u1', role: 'assistant', parts: [], createdAt: at(2) },
    { id: 'u2', parentId: 'a1', role: 'user', parts: [], createdAt: at(3) },
    { id: 'a2', parentId: 'u2', role: 'assistant', parts: [], createdAt: at(4) },
    { id: 'a3', parentId: 'u2', role: 'assistant', parts: [], createdAt: at(5) },
  ];

  it('active leaf 缺失时使用最近消息作为默认路径叶子', () => {
    expect(pickActiveLeafId(rows, null)).toBe('a3');
    expect(pickActiveLeafId(rows, 'missing')).toBe('a3');
    expect(pickActiveLeafId(rows, 'a2')).toBe('a2');
  });

  it('从 leaf 还原 root 到 leaf 的 active path', () => {
    expect(buildPathIds(rows, 'a2')).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('按 parent 收集 sibling，支持同一 user 下多次回答', () => {
    expect(buildSiblingIdsByParent(rows).get('u2')).toEqual(['a2', 'a3']);
  });

  it('切换到中间节点时落到该子树最近叶子', () => {
    expect(pickLatestLeafId(rows, 'u2')).toBe('a3');
    expect(pickLatestLeafId(rows, 'a2')).toBe('a2');
  });

  it('从指定 message 分叉时截断 active path 再追加用户消息', () => {
    const storedMessages: UIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: '起点' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: '回答' }] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: '后续' }] },
      { id: 'a2', role: 'assistant', parts: [{ type: 'text', text: '后续回答' }] },
    ];
    const incoming: UIMessage[] = [{ id: 'branch-user', role: 'user', parts: [{ type: 'text', text: '从回答分叉' }] }];

    expect(mergeIncomingUserMessageAtParent(storedMessages, incoming, 'a1').map((message) => message.id)).toEqual([
      'u1',
      'a1',
      'branch-user',
    ]);
  });
});

describe('listSessions', () => {
  it('侧栏会话列表按最近活动时间排序', () => {
    const source = readFileSync(new URL('./session-message-store.service.ts', import.meta.url), 'utf8');
    const listSessionsBlock = source.slice(source.indexOf('export async function listSessions'), source.indexOf('/** 从首条用户消息抽取'));

    expect(listSessionsBlock).toContain("orderBy: { updatedAt: 'desc' }");
    expect(listSessionsBlock).toContain("messages: { orderBy: { createdAt: 'desc' }, take: 1 }");
  });
});
