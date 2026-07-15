import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createChatStream: vi.fn(),
  ensureChatTitle: vi.fn(),
  ensureVisibleAssistantReply: vi.fn((messages) => messages),
  getSessionWithRepository: vi.fn(),
  loadActiveModelConfig: vi.fn(),
  loadMessages: vi.fn(),
  mergeIncomingUserMessageAtParent: vi.fn(),
  mergePersistedMessages: vi.fn(),
  publishSessionListChanged: vi.fn(),
  saveMessages: vi.fn(),
}));

vi.mock('../agent/chat-agent', () => ({ createChatStream: mocks.createChatStream }));
vi.mock('../ai-models/ai-models.service', () => ({ loadActiveModelConfig: mocks.loadActiveModelConfig }));
vi.mock('../agent/review-message', () => ({ ensureVisibleAssistantReply: mocks.ensureVisibleAssistantReply }));
vi.mock('../sessions/session-events.service', () => ({ publishSessionListChanged: mocks.publishSessionListChanged }));
vi.mock('../sessions/session-message-store.service', () => ({
  ensureChatTitle: mocks.ensureChatTitle,
  getSessionWithRepository: mocks.getSessionWithRepository,
  loadMessages: mocks.loadMessages,
  mergeIncomingUserMessageAtParent: mocks.mergeIncomingUserMessageAtParent,
  mergePersistedMessages: mocks.mergePersistedMessages,
  saveMessages: mocks.saveMessages,
}));
vi.mock('../../shared/logger/logger.service', () => ({
  createLogger: () => ({ error: vi.fn() }),
}));

import { prepareChatStream } from './chat.service';

const selectedModelConfig = {
  provider: 'openai-compatible',
  modelId: 'glm-code',
  apiKey: 'secret',
  apiBaseUrl: 'https://gateway.test/v1',
  maxSteps: 12,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSessionWithRepository.mockResolvedValue({
    id: 'session-1',
    status: 'completed',
    repository: null,
  });
  mocks.loadMessages.mockResolvedValue([]);
  mocks.mergeIncomingUserMessageAtParent.mockReturnValue([]);
  mocks.createChatStream.mockResolvedValue({ id: 'stream' });
});

describe('prepareChatStream model selection', () => {
  it.each(['', '   ', null])('rejects an empty or non-string model id: %j', async (aiModelId) => {
    await expect(prepareChatStream({ sessionId: 'session-1', aiModelId })).resolves.toEqual({
      kind: 'invalid-model',
      message: '所选模型无效',
    });
    expect(mocks.getSessionWithRepository).not.toHaveBeenCalled();
    expect(mocks.loadActiveModelConfig).not.toHaveBeenCalled();
  });

  it('rejects a missing or inactive model without falling back', async () => {
    mocks.loadActiveModelConfig.mockResolvedValue(null);

    await expect(prepareChatStream({ sessionId: 'session-1', aiModelId: 'unavailable-model' })).resolves.toEqual({
      kind: 'invalid-model',
      message: '所选模型不存在或已停用',
    });
    expect(mocks.loadActiveModelConfig).toHaveBeenCalledWith('unavailable-model');
    expect(mocks.loadMessages).not.toHaveBeenCalled();
    expect(mocks.createChatStream).not.toHaveBeenCalled();
  });

  it('rejects an unavailable model before checking the running-session conflict', async () => {
    mocks.getSessionWithRepository.mockResolvedValue({
      id: 'session-1',
      status: 'running',
      repository: null,
    });
    mocks.loadActiveModelConfig.mockResolvedValue(null);

    await expect(prepareChatStream({ sessionId: 'session-1', aiModelId: 'inactive-model' })).resolves.toEqual({
      kind: 'invalid-model',
      message: '所选模型不存在或已停用',
    });
  });

  it('passes the resolved active model config to the chat stream', async () => {
    mocks.loadActiveModelConfig.mockResolvedValue(selectedModelConfig);

    const result = await prepareChatStream({ sessionId: 'session-1', aiModelId: 'model-1' });

    expect(result.kind).toBe('ready');
    expect(mocks.createChatStream).toHaveBeenCalledWith({
      session: expect.objectContaining({ id: 'session-1' }),
      messages: [],
      selectedModelConfig,
    });
  });

  it('keeps the existing default model path when no model is selected', async () => {
    const result = await prepareChatStream({ sessionId: 'session-1' });

    expect(result.kind).toBe('ready');
    expect(mocks.loadActiveModelConfig).not.toHaveBeenCalled();
    const streamOptions = mocks.createChatStream.mock.calls[0]?.[0];
    expect(streamOptions).not.toHaveProperty('selectedModelConfig');
  });
});
