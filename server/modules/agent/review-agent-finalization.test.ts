import { generateText, type LanguageModel, type ModelMessage } from 'ai';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  createPrimaryReviewFinalizer,
  PRIMARY_FINALIZATION_INSTRUCTIONS,
} from './review-agent';
import { createReviewRuntimeMemory } from './review-runtime-memory';

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, generateText: vi.fn() };
});

const generateTextMock = generateText as unknown as Mock;
const model = {} as LanguageModel;
const initialMessages: ModelMessage[] = [{ role: 'user', content: '请审查本次 Push。' }];
const responseMessages: ModelMessage[] = [{ role: 'assistant', content: '现在继续查看源码。' }];
const validReview = [
  '## 审查总评',
  '未发现需要阻塞的实质问题。',
  '## 严重',
  '未发现严重问题。',
  '## 一般',
  '未发现一般问题。',
  '## 建议',
  '暂无建议。',
].join('\n');

describe('主审查强制收敛', () => {
  beforeEach(() => {
    generateTextMock.mockReset();
  });

  it('只开放提交工具，并允许模型按校验错误纠正总评', async () => {
    generateTextMock.mockImplementationOnce(async (options: {
      messages: ModelMessage[];
      tools: { submit_primary_review: { execute: (input: { markdown: string }) => unknown } };
      toolChoice: unknown;
      system: string;
    }) => {
      expect(options.messages).toEqual(expect.arrayContaining(initialMessages));
      expect(options.messages).toEqual(expect.arrayContaining(responseMessages));
      expect(Object.keys(options.tools)).toEqual(['submit_primary_review']);
      expect(options.toolChoice).toEqual({ type: 'tool', toolName: 'submit_primary_review' });
      expect(options.system).toBe(PRIMARY_FINALIZATION_INSTRUCTIONS);

      expect(options.tools.submit_primary_review.execute({ markdown: '现在继续查看源码。' })).toMatchObject({
        accepted: false,
        error: expect.stringContaining('无法提取待裁决问题'),
      });
      expect(options.tools.submit_primary_review.execute({ markdown: validReview })).toEqual({ accepted: true });
      return {};
    });

    const finalizePrimaryReview = createPrimaryReviewFinalizer({
      model,
      initialMessages,
      responseMessages: Promise.resolve(responseMessages),
      runtimeMemory: createReviewRuntimeMemory(),
    });

    await expect(finalizePrimaryReview()).resolves.toBe(validReview);
    expect(generateTextMock).toHaveBeenCalledOnce();
  });

  it('三步内没有提交合法总评时快速失败', async () => {
    generateTextMock.mockResolvedValueOnce({});
    const finalizePrimaryReview = createPrimaryReviewFinalizer({
      model,
      initialMessages,
      responseMessages: Promise.resolve(responseMessages),
      runtimeMemory: createReviewRuntimeMemory(),
    });

    await expect(finalizePrimaryReview()).rejects.toThrow('仍未通过最终总评校验（已纠正 3 次）');
  });
});
