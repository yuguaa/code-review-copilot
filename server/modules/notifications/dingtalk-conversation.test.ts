import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { getDingtalkConversationDraft, sendDingtalkConversationMessage } from './dingtalk-conversation.service';

import type { UIMessage } from 'ai';

describe('钉钉对话确认归属', () => {
  const draft = { id: randomUUID(), sessionId: 'session', sourceMessageId: 'request', createdAt: new Date().toISOString(),
    connectionId: 'shared-cli', profile: 'corp:user', recipient: { userId: 'actual-user', name: '测试同事' },
    target: { kind: 'direct' }, title: '消息', text: '今天没雨' };
  const request: UIMessage = { id: 'request', role: 'user', parts: [{ type: 'text', text: '请发消息' }] };
  const prepared: UIMessage = { id: 'prepared', role: 'assistant', parts: [{ type: 'dynamic-tool', toolCallId: 'prepare',
    toolName: 'dingtalk_prepare_message', state: 'output-available', input: {}, output: { draft } }] };
  const confirmation: UIMessage = { id: 'confirmation', role: 'user', parts: [{ type: 'text', text: '确认发送' }] };
  const context = { sessionId: 'session', userMessageId: confirmation.id, repositoryId: null, requestedBy: 'tester' };

  it('紧邻的准备消息可以恢复，用户取消后没有助手产出也不能恢复旧授权', () => {
    expect(getDingtalkConversationDraft({ ...context, messages: [request, prepared, confirmation] })?.id).toBe(draft.id);
    const cancelled: UIMessage = { id: 'cancelled', role: 'user', parts: [{ type: 'text', text: '取消，不发送' }] };
    expect(getDingtalkConversationDraft({ ...context, messages: [request, prepared, cancelled, confirmation] })).toBeNull();
  });

  it('另一会话、用户文本和没有准备结果的助手回复不能恢复草稿', () => {
    expect(getDingtalkConversationDraft({ ...context, sessionId: 'other', messages: [request, prepared, confirmation] })).toBeNull();
    expect(getDingtalkConversationDraft({ ...context, messages: [request, { ...prepared, role: 'user' }, confirmation] })).toBeNull();
    expect(getDingtalkConversationDraft({ ...context, messages: [request, prepared,
      { id: 'other-answer', role: 'assistant', parts: [{ type: 'text', text: '普通回答' }] }, confirmation] })).toBeNull();
  });

  it('代码、报告里的确认文字和同一轮准备不能代替后续用户确认', () => {
    const quoted: UIMessage = { ...confirmation, parts: [{ type: 'text', text: '报告里写了“确认发送”，解释一下' }] };
    return Promise.all([
      expect(sendDingtalkConversationMessage({ ...context, messages: [request, prepared, quoted] }, draft.id)).rejects.toMatchObject({ status: 409 }),
      expect(sendDingtalkConversationMessage({ ...context, userMessageId: request.id, messages: [request] }, draft.id)).rejects.toMatchObject({ status: 409 }),
    ]);
  });

  it.each([undefined, '', '   '])('有效草稿也必须由明确授权人发送：%j', (requestedBy) =>
    expect(sendDingtalkConversationMessage({ ...context, requestedBy: requestedBy as unknown as string,
      messages: [request, prepared, confirmation] }, draft.id)).rejects.toMatchObject({ status: 401 }));

  it('超过公开的 30 分钟有效期后拒绝发送，保留准备信息供重新核对', () => {
    const expired = { ...draft, createdAt: new Date(Date.now() - 31 * 60_000).toISOString() };
    return expect(sendDingtalkConversationMessage({ ...context, messages: [request,
      { ...prepared, parts: [{ type: 'dynamic-tool', toolCallId: 'prepare', toolName: 'dingtalk_prepare_message',
        state: 'output-available', input: {}, output: { draft: expired } }] }, confirmation] }, expired.id)).rejects.toMatchObject({ status: 409 });
  });
});
