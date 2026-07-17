import type { LanguageModel } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  generateText: vi.fn(),
  resolveModel: vi.fn(),
}));

vi.mock('../../infrastructure/prisma/prisma.service', () => ({
  prisma: { aIModel: { findUnique: mocks.findUnique } },
}));

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText: mocks.generateText,
}));

vi.mock('../ai-models/ai-models.service', () => ({
  resolveModel: mocks.resolveModel,
}));

import { testAIModel } from './ai-model-settings.service';

const storedModel = {
  id: 'model-1',
  provider: 'openai-compatible',
  modelId: 'coder',
  apiKey: 'secret',
  apiBaseUrl: 'https://model.test/v1',
  maxSteps: 16,
  isDefault: false,
  isActive: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('testAIModel', () => {
  it('对已保存的停用模型发起最小生成请求', async () => {
    const languageModel = { modelId: 'coder' } as unknown as LanguageModel;
    mocks.findUnique.mockResolvedValue(storedModel);
    mocks.resolveModel.mockReturnValue(languageModel);
    mocks.generateText.mockResolvedValue({ text: 'OK' });

    await expect(testAIModel('model-1')).resolves.toBe(true);
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id: 'model-1' } });
    expect(mocks.resolveModel).toHaveBeenCalledWith(storedModel);
    expect(mocks.generateText).toHaveBeenCalledWith({
      model: languageModel,
      prompt: '请只回复 OK。',
      maxOutputTokens: 8,
      maxRetries: 0,
      timeout: 15_000,
    });
  });

  it('模型配置无法解析时返回连接失败', async () => {
    mocks.findUnique.mockResolvedValue(storedModel);
    mocks.resolveModel.mockImplementation(() => {
      throw new Error('openai-compatible 必须配置 apiBaseUrl');
    });

    await expect(testAIModel('model-1')).resolves.toBe(false);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it('模型服务请求失败时返回连接失败', async () => {
    mocks.findUnique.mockResolvedValue(storedModel);
    mocks.resolveModel.mockReturnValue({} as LanguageModel);
    mocks.generateText.mockRejectedValue(new Error('upstream rejected'));

    await expect(testAIModel('model-1')).resolves.toBe(false);
  });

  it('模型不存在时返回 null 且不发起请求', async () => {
    mocks.findUnique.mockResolvedValue(null);

    await expect(testAIModel('missing-model')).resolves.toBeNull();
    expect(mocks.resolveModel).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });
});
