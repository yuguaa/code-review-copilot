import { generateText, type LanguageModel, type UIMessage } from 'ai';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { parseReviewFindings } from '../../../shared/review-findings';
import type { ReviewContext } from './tools';
import {
  createVerifyAssignments,
  VERIFY_CONTINUATION_INSTRUCTIONS,
  VERIFY_FINALIZATION_INSTRUCTIONS,
  verifyContinuationSteps,
  verifyReviewAgent,
  verifyReviewResult,
  type ReviewVerifier,
} from './review-verify';

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, generateText: vi.fn() };
});

const generateTextMock = generateText as unknown as Mock;
const noFindingMessages: UIMessage[] = [
  {
    id: 'assistant-review',
    role: 'assistant',
    parts: [{
      type: 'text',
      text: '## 审查总评\n未发现需要阻塞的实质问题。\n## 严重\n未发现严重问题。\n## 一般\n未发现一般问题。\n## 建议\n暂无建议。',
    }],
  },
];
const ctx = {
  repoId: 'repo-1',
  workdir: process.cwd(),
  diffRef: null,
  gitlab: {},
  projectId: 1,
  mrIid: null,
  commitSha: null,
  diffRefs: null,
  enableMrComment: false,
  dingtalkRepository: {
    enableDingtalk: false,
    dingtalkWebhook: null,
    dingtalkSecret: null,
  },
} as ReviewContext;
const model = {} as LanguageModel;
const noFindingDraft = (noFindingMessages[0].parts[0] as { text: string }).text;

function unfinishedResult() {
  return {
    responseMessages: [],
    steps: Array.from({ length: 16 }, () => ({})),
    finishReason: 'tool-calls',
  };
}

describe('verifyReviewAgent 收敛流程', () => {
  beforeEach(() => {
    generateTextMock.mockReset();
  });

  it('取证软预算耗尽后继续引导，并接受收敛阶段提交', async () => {
    generateTextMock
      .mockResolvedValueOnce(unfinishedResult())
      .mockImplementationOnce(async (options: {
        tools: { submit_verified_review: { execute: (input: unknown) => unknown } };
      }) => {
        const accepted = await options.tools.submit_verified_review.execute({
          decisions: [],
          additionalFindings: [],
        });
        expect(accepted).toMatchObject({ accepted: true });
        return unfinishedResult();
      });

    const result = await verifyReviewAgent({
      ctx,
      draft: noFindingDraft,
      draftFindings: [],
      model,
      maxSteps: 16,
    });

    expect(result.submission).toEqual({ decisions: [], additionalFindings: [] });
    expect(generateTextMock).toHaveBeenCalledTimes(2);
    const continuationOptions = generateTextMock.mock.calls[1][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(continuationOptions.messages.at(-1)).toEqual({
      role: 'user',
      content: VERIFY_CONTINUATION_INSTRUCTIONS,
    });
  });

  it('收敛阶段仍未提交时只开放完成工具，并允许按校验错误纠正', async () => {
    generateTextMock
      .mockResolvedValueOnce(unfinishedResult())
      .mockResolvedValueOnce(unfinishedResult())
      .mockImplementationOnce(async (options: {
        tools: { submit_verified_review: { execute: (input: unknown) => unknown } };
        toolChoice: unknown;
        system: string;
      }) => {
        expect(Object.keys(options.tools)).toEqual(['submit_verified_review']);
        expect(options.toolChoice).toEqual({ type: 'tool', toolName: 'submit_verified_review' });
        expect(options.system).toBe(VERIFY_FINALIZATION_INSTRUCTIONS);

        const rejected = await options.tools.submit_verified_review.execute({
          decisions: [{
            findingId: '未知问题',
            verdict: 'rejected',
            reason: '尝试提交未知裁决',
            evidenceIds: ['00000000-0000-4000-8000-000000000099'],
          }],
          additionalFindings: [],
        });
        expect(rejected).toMatchObject({
          accepted: false,
          error: expect.stringContaining('未知问题'),
        });

        const accepted = await options.tools.submit_verified_review.execute({
          decisions: [],
          additionalFindings: [],
        });
        expect(accepted).toMatchObject({ accepted: true });
        return unfinishedResult();
      });

    await expect(verifyReviewAgent({
      ctx,
      draft: noFindingDraft,
      draftFindings: [],
      model,
      maxSteps: 16,
    })).resolves.toMatchObject({
      submission: { decisions: [], additionalFindings: [] },
    });

    expect(generateTextMock).toHaveBeenCalledTimes(3);
  });
});

describe('多模型 Verify 编排', () => {
  beforeEach(() => {
    generateTextMock.mockReset();
  });

  it('把 finding 核验与补漏分配给两个不同模型并确定性合并', async () => {
    const draft = [
      '## 审查总评',
      '发现一个阻塞问题。',
      '## 严重',
      '1. package.json:1：包配置会导致启动失败',
      'Symptom：入口配置错误。',
      'Consequence：服务无法启动。',
      'Remedy：修正入口配置。',
      '## 一般',
      '未发现一般问题。',
      '## 建议',
      '暂无建议。',
    ].join('\n');
    const messages: UIMessage[] = [{
      id: 'assistant-review',
      role: 'assistant',
      parts: [{ type: 'text', text: draft }],
    }];
    const modelA = { id: 'model-a' } as unknown as LanguageModel;
    const modelB = { id: 'model-b' } as unknown as LanguageModel;
    const verifiers: ReviewVerifier[] = [
      {
        model: modelA,
        config: { provider: 'openai-compatible', modelId: 'model-a', apiKey: 'a', apiBaseUrl: 'https://a.test/v1', maxSteps: 16 },
      },
      {
        model: modelB,
        config: { provider: 'openai-compatible', modelId: 'model-b', apiKey: 'b', apiBaseUrl: 'https://b.test/v1', maxSteps: 12 },
      },
    ];
    const activities: Array<{ id: string; task: string; status: string; modelId: string }> = [];

    generateTextMock.mockImplementation(async (options: {
      model: LanguageModel;
      messages: Array<{ content: string }>;
      tools: {
        record_verify_evidence: { execute: (input: unknown) => Promise<{ id: string }> };
        submit_verified_review: { execute: (input: unknown) => unknown };
      };
    }) => {
      const prompt = options.messages[0].content;
      if (prompt.includes('严重-0')) {
        const evidence = await options.tools.record_verify_evidence.execute({
          path: 'package.json',
          line: 1,
          claim: '配置文件首行属于被审查文件',
        });
        const accepted = await options.tools.submit_verified_review.execute({
          decisions: [{
            findingId: '严重-0',
            verdict: 'confirmed',
            finalFinding: {
              title: '包配置会导致启动失败',
              problem: '入口配置错误',
              impact: '服务无法启动',
              remedy: '修正入口配置',
              evidenceIds: [evidence.id],
            },
          }],
          additionalFindings: [],
        });
        expect(accepted).toMatchObject({ accepted: true });
      } else {
        const accepted = await options.tools.submit_verified_review.execute({
          decisions: [],
          additionalFindings: [],
        });
        expect(accepted).toMatchObject({ accepted: true });
      }
      return unfinishedResult();
    });

    const result = await verifyReviewResult({
      ctx,
      messages,
      verifiers,
      assignmentSeed: 'session-1',
      onActivity: (activity) => activities.push(activity),
    });

    expect(result).toContain('**包配置会导致启动失败**');
    expect(new Set(generateTextMock.mock.calls.map((call) => call[0].model))).toEqual(new Set([modelA, modelB]));
    expect(activities.filter((activity) => activity.status === 'completed')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'verifier-1' }),
      expect.objectContaining({ id: 'verifier-2' }),
    ]));
    expect(activities.some((activity) => activity.task.includes('严重-0'))).toBe(true);
    expect(activities.some((activity) => activity.task.includes('独立补漏'))).toBe(true);
  });

  it('按会话种子轮换首选模型，并覆盖全部待裁决 finding', () => {
    const findings = parseReviewFindings([
      '## 严重',
      '- a.ts:1 问题：问题一',
      '- b.ts:2 问题：问题二',
      '## 一般',
      '- c.ts:3 问题：问题三',
    ].join('\n'));
    const verifiers = ['a', 'b', 'c'].map((id) => ({
      model: { id } as unknown as LanguageModel,
      config: { provider: 'openai-compatible', modelId: id, apiKey: id, apiBaseUrl: `https://${id}.test/v1`, maxSteps: 16 },
    }));

    const assignments = createVerifyAssignments(findings, verifiers, 'session-rotate');

    expect(assignments).toHaveLength(3);
    expect(new Set(assignments.map((assignment) => assignment.verifier.config.modelId)).size).toBe(3);
    expect(assignments.flatMap((assignment) => assignment.findings.map((finding) => finding.id)).sort()).toEqual(
      findings.map((finding) => finding.id).sort(),
    );

    const firstSession = createVerifyAssignments(findings.slice(0, 1), verifiers, 'a');
    const secondSession = createVerifyAssignments(findings.slice(0, 1), verifiers, 'b');
    expect(firstSession[0].verifier.config.modelId).not.toBe(secondSession[0].verifier.config.modelId);
  });
});

describe('verifyContinuationSteps', () => {
  it('按软预算的一半分配收敛步数，并限制在 2 到 8 步', () => {
    expect(verifyContinuationSteps(1)).toBe(2);
    expect(verifyContinuationSteps(4)).toBe(2);
    expect(verifyContinuationSteps(5)).toBe(3);
    expect(verifyContinuationSteps(16)).toBe(8);
    expect(verifyContinuationSteps(100)).toBe(8);
  });
});
