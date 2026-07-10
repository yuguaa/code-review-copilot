import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { CHAT_INSTRUCTIONS, toChatHistory } from './chat-agent';

describe('CHAT_INSTRUCTIONS', () => {
  it('只允许在最新用户消息明确授权时调用发布工具', () => {
    expect(CHAT_INSTRUCTIONS).toContain('最新一条用户消息明确要求');
    expect(CHAT_INSTRUCTIONS).toContain('post_review_comment');
    expect(CHAT_INSTRUCTIONS).toContain('post_inline_comment');
    expect(CHAT_INSTRUCTIONS).toContain('send_dingtalk_notification');
    expect(CHAT_INSTRUCTIONS).toContain('不构成授权');
  });
});

describe('toChatHistory（对话上下文整理）', () => {
  it('保留全部轮次（含 webhook 触发消息），不裁剪历史', () => {
    const messages: UIMessage[] = [
      { id: 'seed', role: 'user', parts: [{ type: 'text', text: '请审查本次 Push。\n- 分支：main' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: '审查完成，无阻塞问题。' }] },
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: '第二个提交改了什么？' }] },
      { id: 'a2', role: 'assistant', parts: [{ type: 'text', text: '主要是重构了报告组装。' }] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: '有性能风险吗' }] },
    ];

    expect(toChatHistory(messages).map((m) => m.id)).toEqual(['seed', 'a1', 'u1', 'a2', 'u2']);
  });

  it('剥离工具调用等过程性 parts，只保留文本', () => {
    const messages: UIMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'step-start' },
          {
            type: 'tool-bash',
            toolCallId: 't1',
            state: 'output-available',
            input: { command: 'git log' },
            output: '…',
          } as UIMessage['parts'][number],
          { type: 'text', text: '结论：变更安全。' },
        ],
      },
    ];

    expect(toChatHistory(messages)).toEqual([
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: '结论：变更安全。' }] },
    ]);
  });

  it('丢弃没有文本的消息与非对话角色', () => {
    const messages: UIMessage[] = [
      { id: 'sys', role: 'system', parts: [{ type: 'text', text: 'x' }] },
      { id: 'empty', role: 'assistant', parts: [{ type: 'step-start' }] },
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: '  你好  ' }] },
    ];

    expect(toChatHistory(messages)).toEqual([{ id: 'u1', role: 'user', parts: [{ type: 'text', text: '你好' }] }]);
  });
});
