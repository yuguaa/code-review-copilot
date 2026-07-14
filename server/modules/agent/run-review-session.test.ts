import type { UIMessage } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewActivityState } from '../../../shared/review-activity';
import { runReviewSession } from './run-review';

const mocks = vi.hoisted(() => ({
  getSessionWithRepository: vi.fn(),
  loadMessages: vi.fn(),
  saveMessages: vi.fn(),
  createReviewStream: vi.fn(),
  verifyReviewResult: vi.fn(),
  runReviewCompletionIntegrations: vi.fn(),
  publishSessionMessages: vi.fn(),
  markReviewSessionCompleted: vi.fn(),
  markReviewSessionFailed: vi.fn(),
  streamedMessage: null as UIMessage | null,
}));

vi.mock('../sessions/session-message-store.service', () => ({
  getSessionWithRepository: mocks.getSessionWithRepository,
  loadMessages: mocks.loadMessages,
  saveMessages: mocks.saveMessages,
  mergeStreamingMessage: (messages: UIMessage[], message: UIMessage) => [...messages, message],
}));

vi.mock('./review-agent', () => ({
  createReviewStream: mocks.createReviewStream,
}));

vi.mock('./review-verify', async (importOriginal) => ({
  ...await importOriginal<typeof import('./review-verify')>(),
  verifyReviewResult: mocks.verifyReviewResult,
}));

vi.mock('./review-notification', () => ({
  runReviewCompletionIntegrations: mocks.runReviewCompletionIntegrations,
}));

vi.mock('../sessions/session-events.service', () => ({
  publishSessionMessages: mocks.publishSessionMessages,
}));

vi.mock('../sessions/session-lifecycle.service', () => ({
  STOPPED_REVIEW_ERROR: '用户手动停止审查',
  markReviewSessionCompleted: mocks.markReviewSessionCompleted,
  markReviewSessionFailed: mocks.markReviewSessionFailed,
}));

vi.mock('../../shared/logger/logger.service', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('ai', async (importOriginal) => ({
  ...await importOriginal<typeof import('ai')>(),
  readUIMessageStream: vi.fn(() => ({
    async *[Symbol.asyncIterator]() {
      if (mocks.streamedMessage) yield mocks.streamedMessage;
    },
  })),
}));

const initialMessages: UIMessage[] = [
  { id: 'user-1', role: 'user', parts: [{ type: 'text', text: '请审查本次 Push' }] },
];

const validPrimaryMessage: UIMessage = {
  id: 'assistant-1',
  role: 'assistant',
  parts: [{
    type: 'text',
    text: [
      '## 严重',
      '未发现严重问题。',
      '',
      '## 一般',
      '1. `src/index.ts:10`',
      '   - 问题：状态判断错误。',
      '   - 影响：会把成功审查标记为失败。',
      '   - 修复建议：以主审查结果作为成功判据。',
      '',
      '## 建议',
      '暂无建议。',
    ].join('\n'),
  }],
};

function activityStateOf(messages: UIMessage[]): ReviewActivityState | undefined {
  for (const part of messages.flatMap((message) => message.parts)) {
    const record = part as { type?: unknown; data?: ReviewActivityState };
    if (record.type === 'data-review-activity') return record.data;
  }
  return undefined;
}

describe('runReviewSession success contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.streamedMessage = validPrimaryMessage;
    mocks.getSessionWithRepository.mockResolvedValue({ id: 'session-1' });
    mocks.loadMessages.mockResolvedValue(initialMessages);
    mocks.saveMessages.mockResolvedValue(undefined);
    mocks.markReviewSessionCompleted.mockResolvedValue(undefined);
    mocks.markReviewSessionFailed.mockResolvedValue(undefined);
    mocks.runReviewCompletionIntegrations.mockResolvedValue([]);
    mocks.createReviewStream.mockResolvedValue({
      stream: { toUIMessageStream: vi.fn(() => new ReadableStream()) },
      ctx: {},
      blueprint: undefined,
      runtimeMemory: undefined,
      primaryConfig: { provider: 'openai', modelId: 'gpt-5' },
      verifiers: [
        { config: { provider: 'openai-compatible', modelId: 'glm-5.2' } },
        { config: { provider: 'openai-compatible', modelId: 'mimo-v2.5' } },
      ],
    });
  });

  it('主审查有效时忽略 Verify 失败，并保留流式错误活动', async () => {
    mocks.verifyReviewResult.mockImplementation(({ onActivity }) => {
      onActivity?.({
        id: 'verifier-2',
        label: 'Verify Agent 2',
        provider: 'openai-compatible',
        modelId: 'mimo-v2.5',
        task: '独立补漏',
        status: 'running',
      }, 'verifying');
      onActivity?.({
        id: 'verifier-1',
        label: 'Verify Agent 1',
        provider: 'openai-compatible',
        modelId: 'glm-5.2',
        task: '复核增强失败：Invalid JSON response',
        status: 'failed',
      }, 'verifying');
      throw new Error('Verify 分片没有可用模型');
    });

    await runReviewSession('session-1');

    expect(mocks.markReviewSessionCompleted).toHaveBeenCalledWith('session-1');
    expect(mocks.markReviewSessionFailed).not.toHaveBeenCalled();
    expect(mocks.runReviewCompletionIntegrations).not.toHaveBeenCalled();

    const savedMessages = mocks.saveMessages.mock.calls.at(-1)?.[1] as UIMessage[];
    expect(activityStateOf(savedMessages)).toMatchObject({
      phase: 'completed',
      agents: expect.arrayContaining([
        expect.objectContaining({ id: 'primary', status: 'completed' }),
        expect.objectContaining({ id: 'verifier-1', status: 'failed' }),
        expect.objectContaining({ id: 'verifier-2', status: 'failed' }),
        expect.objectContaining({ id: 'verification-result', status: 'failed' }),
      ]),
    });
    expect(activityStateOf(savedMessages)?.agents).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'review-error' })]),
    );
  });

  it('主审查正文不可判定时仍标记整体失败', async () => {
    mocks.streamedMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: '本次改动整体看起来不错。' }],
    };

    await runReviewSession('session-1');

    expect(mocks.verifyReviewResult).not.toHaveBeenCalled();
    expect(mocks.markReviewSessionCompleted).not.toHaveBeenCalled();
    expect(mocks.markReviewSessionFailed).toHaveBeenCalledWith(
      'session-1',
      '主审查结果格式无效，请检查主审查模型输出',
    );
  });

  it('没有足够的 Verify 模型时显式跳过增强', async () => {
    mocks.createReviewStream.mockResolvedValue({
      stream: { toUIMessageStream: vi.fn(() => new ReadableStream()) },
      ctx: {},
      blueprint: undefined,
      runtimeMemory: undefined,
      primaryConfig: { provider: 'openai', modelId: 'gpt-5' },
      verifiers: [],
    });

    await runReviewSession('session-1');

    expect(mocks.verifyReviewResult).not.toHaveBeenCalled();
    expect(mocks.markReviewSessionCompleted).toHaveBeenCalledWith('session-1');
    expect(mocks.runReviewCompletionIntegrations).not.toHaveBeenCalled();
  });

  it('Verify 汇总失败时在活动流记录增强终态错误', async () => {
    mocks.verifyReviewResult.mockImplementation(({ onActivity }) => {
      const verifier = {
        id: 'verifier-1',
        label: 'Verify Agent 1',
        provider: 'openai-compatible',
        modelId: 'glm-5.2',
        task: '独立核验问题',
      };
      onActivity?.({ ...verifier, status: 'running' }, 'verifying');
      onActivity?.({ ...verifier, status: 'completed' });
      return Promise.reject(new Error('Verify Agent 在汇总阶段失败'));
    });

    await runReviewSession('session-1');

    const savedMessages = mocks.saveMessages.mock.calls.at(-1)?.[1] as UIMessage[];
    expect(activityStateOf(savedMessages)).toMatchObject({
      phase: 'completed',
      agents: expect.arrayContaining([
        expect.objectContaining({
          id: 'verification-result',
          status: 'failed',
          task: expect.stringContaining('复核增强未采用'),
        }),
      ]),
    });
    expect(mocks.markReviewSessionCompleted).toHaveBeenCalledWith('session-1');
    expect(mocks.markReviewSessionFailed).not.toHaveBeenCalled();
  });

  it('Verify 成功时采用增强结论并追加到主审查消息', async () => {
    mocks.verifyReviewResult.mockImplementation(({ onActivity }) => {
      const verifier = {
        id: 'verifier-1',
        label: 'Verify Agent 1',
        provider: 'openai-compatible',
        modelId: 'glm-5.2',
        task: '独立核验问题',
      };
      onActivity?.({ ...verifier, status: 'running' }, 'verifying');
      onActivity?.({ ...verifier, status: 'completed' });
      return Promise.resolve('复核后的最终结论');
    });

    await runReviewSession('session-1');

    expect(mocks.markReviewSessionCompleted).toHaveBeenCalledWith('session-1');
    expect(mocks.runReviewCompletionIntegrations).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.any(Array),
      '复核后的最终结论',
    );
    const savedMessages = mocks.saveMessages.mock.calls.at(-1)?.[1] as UIMessage[];
    expect(activityStateOf(savedMessages)).toMatchObject({
      phase: 'completed',
      agents: expect.arrayContaining([
        expect.objectContaining({ id: 'verifier-1', status: 'completed' }),
      ]),
    });
    expect(savedMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'assistant-1',
        parts: expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: '## Verify 结论\n复核后的最终结论',
            reviewPartKind: 'verified-review',
          }),
        ]),
      }),
    ]));
  });
});
