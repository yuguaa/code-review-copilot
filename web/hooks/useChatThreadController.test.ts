import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildChatRequestBody, toEnabledChatModelOptions } from './useChatThreadController';

describe('追问模型选择', () => {
  it('只把已启用模型转换为追问选项', () => {
    expect(
      toEnabledChatModelOptions([
        { id: 'm1', provider: 'openai', modelId: 'gpt-5', apiBaseUrl: null, isDefault: true, isActive: true },
        { id: 'm2', provider: 'anthropic', modelId: 'claude-sonnet', apiBaseUrl: null, isDefault: false, isActive: false },
      ]),
    ).toEqual([{ id: 'm1', label: 'openai/gpt-5（默认）' }]);
  });

  it('为同名启用模型追加端点和稳定 ID，避免选项歧义', () => {
    expect(toEnabledChatModelOptions([
      { id: 'model-aaa111', provider: 'openai-compatible', modelId: 'coder', apiBaseUrl: 'https://user:password@a.test/v1', isDefault: true, isActive: true },
      { id: 'model-bbb222', provider: 'openai-compatible', modelId: 'coder', apiBaseUrl: 'https://b.test/v1', isDefault: false, isActive: true },
    ])).toEqual([
      { id: 'model-aaa111', label: 'openai-compatible/coder（默认） · a.test · #aaa111' },
      { id: 'model-bbb222', label: 'openai-compatible/coder · b.test · #bbb222' },
    ]);
  });

  it('未选择模型时省略 aiModelId，继续跟随会话配置', () => {
    expect(buildChatRequestBody(null, '')).toEqual({ parentMessageId: null });
  });

  it('普通发送和重新回答可复用同一模型请求体', () => {
    expect(buildChatRequestBody('message-1', 'model-1')).toEqual({
      parentMessageId: 'message-1',
      aiModelId: 'model-1',
    });
  });

  it('普通发送和重新回答都接入当前模型选择', () => {
    const source = readFileSync(new URL('./useChatThreadController.ts', import.meta.url), 'utf8');
    expect(source).toContain(
      'sendMessage({ text }, { body: buildChatRequestBody(parentMessageId, selectedAIModelId) })',
    );
    expect(source).toContain(
      'regenerate({ messageId, body: buildChatRequestBody(messageId, selectedAIModelId) })',
    );
  });
});
