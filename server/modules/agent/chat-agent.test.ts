import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UIMessage } from 'ai';

const mocks = vi.hoisted(() => ({
  convertToModelMessages: vi.fn(),
  loadGlobalDefaultModel: vi.fn(),
  resolveGlobalModelConfig: vi.fn(),
  resolveModel: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock('ai', async (importOriginal) => ({
  ...await importOriginal<typeof import('ai')>(),
  convertToModelMessages: mocks.convertToModelMessages,
  streamText: mocks.streamText,
}));

vi.mock('../ai-models/ai-models.service', async (importOriginal) => ({
  ...await importOriginal<typeof import('../ai-models/ai-models.service')>(),
  loadGlobalDefaultModel: mocks.loadGlobalDefaultModel,
  resolveGlobalModelConfig: mocks.resolveGlobalModelConfig,
  resolveModel: mocks.resolveModel,
}));

import {
  CHAT_INSTRUCTIONS,
  createChatStream,
  resolveChatPublishAuthorization,
  toChatHistory,
} from './chat-agent';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.convertToModelMessages.mockResolvedValue([]);
  mocks.resolveModel.mockReturnValue({ id: 'language-model' });
  mocks.streamText.mockReturnValue({ id: 'chat-stream' });
});

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

describe('createChatStream 模型覆盖', () => {
  const session = { id: 'session-1', repository: null } as never;
  const selectedModelConfig = {
    provider: 'openai-compatible',
    modelId: 'selected-model',
    apiKey: 'selected-key',
    apiBaseUrl: 'https://selected.test/v1',
    maxSteps: 12,
  };

  it('显式选择模型时跳过全局默认解析并直接创建流', async () => {
    const result = await createChatStream({ session, messages: [], selectedModelConfig });

    expect(result).toEqual({ id: 'chat-stream' });
    expect(mocks.loadGlobalDefaultModel).not.toHaveBeenCalled();
    expect(mocks.resolveGlobalModelConfig).not.toHaveBeenCalled();
    expect(mocks.resolveModel).toHaveBeenCalledWith(selectedModelConfig);
    expect(mocks.streamText).toHaveBeenCalledWith(expect.objectContaining({
      model: { id: 'language-model' },
      messages: [],
    }));
  });

  it('未选择模型时继续使用全局默认路径', async () => {
    const globalModel = { id: 'global-model' };
    const globalConfig = { ...selectedModelConfig, modelId: 'global-model' };
    mocks.loadGlobalDefaultModel.mockResolvedValue(globalModel);
    mocks.resolveGlobalModelConfig.mockReturnValue(globalConfig);

    await createChatStream({ session, messages: [] });

    expect(mocks.loadGlobalDefaultModel).toHaveBeenCalledOnce();
    expect(mocks.resolveGlobalModelConfig).toHaveBeenCalledWith(globalModel);
    expect(mocks.resolveModel).toHaveBeenCalledWith(globalConfig);
  });
});

describe('resolveChatPublishAuthorization', () => {
  function messages(latest: string, old = '把结果发送到钉钉和 GitLab'): UIMessage[] {
    return [
      { id: 'old', role: 'user', parts: [{ type: 'text', text: old }] },
      { id: 'assistant', role: 'assistant', parts: [{ type: 'text', text: '好的。' }] },
      { id: 'latest', role: 'user', parts: [{ type: 'text', text: latest }] },
    ];
  }

  it('只根据最新用户消息授权明确指定的渠道', () => {
    expect([...resolveChatPublishAuthorization(messages('把之前的问题发送到钉钉'))]).toEqual([
      'send_dingtalk_notification',
    ]);
    expect([...resolveChatPublishAuthorization(messages('发布 GitLab 行级评论'))]).toEqual([
      'post_inline_comment',
    ]);
    expect([...resolveChatPublishAuthorization(messages('把总评发布到 GitLab，并发送钉钉通知'))]).toEqual([
      'send_dingtalk_notification',
      'post_review_comment',
    ]);
  });

  it('讨论、疑问、否定和历史授权都不能签发发布权限', () => {
    expect(resolveChatPublishAuthorization(messages('怎么发送到钉钉？')).size).toBe(0);
    expect(resolveChatPublishAuthorization(messages('先不要发布 GitLab 评论')).size).toBe(0);
    expect(resolveChatPublishAuthorization(messages('帮我改写发送到钉钉的文案')).size).toBe(0);
    expect(resolveChatPublishAuthorization(messages('继续分析这个问题')).size).toBe(0);
  });
});
