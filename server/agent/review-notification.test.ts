import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UIMessage } from 'ai';
import { notifyReviewCompleted } from './review-notification';
import { prisma } from '../lib/prisma';
import { sendDingtalk } from '../lib/dingtalk';
import type { SessionWithRepository } from '../lib/chat-store';

vi.mock('../lib/prisma', () => ({
  prisma: {
    notificationSetting: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../lib/dingtalk', () => ({
  sendDingtalk: vi.fn().mockResolvedValue(undefined),
}));

function session(overrides: Partial<SessionWithRepository> = {}): SessionWithRepository {
  return {
    id: 's1',
    kind: 'review',
    title: 'Push main (2 commits)',
    repositoryId: 'r1',
    repository: {
      id: 'r1',
      gitLabAccountId: 'g1',
      gitLabAccount: { id: 'g1', url: 'https://gitlab.example.com', accessToken: 'token', webhookSecret: null, createdAt: new Date() },
      gitLabProjectId: 1,
      name: 'polit-agent',
      path: 'group/polit-agent',
      description: null,
      watchBranches: 'main',
      autoReview: true,
      defaultAIModelId: null,
      defaultAIModel: null,
      customProvider: null,
      customModelId: null,
      customApiKey: null,
      customApiBaseUrl: null,
      customMaxSteps: null,
      defaultReviewPrompt: null,
      enableMrComment: false,
      enableDingtalk: true,
      dingtalkWebhook: null,
      dingtalkSecret: null,
      memory: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    mrIid: null,
    mrTitle: null,
    sourceBranch: 'main',
    targetBranch: 'main',
    baseCommitSha: 'base',
    commitSha: 'head',
    author: '苑振江',
    status: 'running',
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    messages: [],
    ...overrides,
  } as SessionWithRepository;
}

const messages: UIMessage[] = [
  { id: 'm1', role: 'assistant', parts: [{ type: 'text', text: '审查通过。' }] },
];

describe('notifyReviewCompleted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('仓库开启钉钉且全局配置存在时发送完成通知', async () => {
    vi.mocked(prisma.notificationSetting.findUnique).mockResolvedValue({
      id: 'n1',
      scope: 'global',
      dingtalkEnabled: true,
      dingtalkWebhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=x',
      dingtalkSecret: 'SEC',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(notifyReviewCompleted(session(), messages)).resolves.toBe('sent');
    expect(sendDingtalk).toHaveBeenCalledWith(
      { webhook: 'https://oapi.dingtalk.com/robot/send?access_token=x', secret: 'SEC' },
      expect.stringContaining('polit-agent'),
      expect.stringContaining('审查通过。'),
    );
  });

  it('没有 assistant 文本时仍发送完成通知', async () => {
    vi.mocked(prisma.notificationSetting.findUnique).mockResolvedValue({
      id: 'n1',
      scope: 'global',
      dingtalkEnabled: true,
      dingtalkWebhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=x',
      dingtalkSecret: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await notifyReviewCompleted(session(), [{ id: 'm1', role: 'assistant', parts: [{ type: 'step-start' }] } as UIMessage]);
    expect(sendDingtalk).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.stringContaining('模型没有返回可展示的文本结果'),
    );
  });

  it('只把最后一条 assistant 文本作为完成通知正文', async () => {
    vi.mocked(prisma.notificationSetting.findUnique).mockResolvedValue({
      id: 'n1',
      scope: 'global',
      dingtalkEnabled: true,
      dingtalkWebhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=x',
      dingtalkSecret: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await notifyReviewCompleted(session(), [
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: '旧回复' }] },
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: '追问' }] },
      { id: 'a2', role: 'assistant', parts: [{ type: 'text', text: '最新首答' }] },
    ]);
    expect(sendDingtalk).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.not.stringContaining('旧回复'),
    );
    expect(sendDingtalk).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.stringContaining('最新首答'),
    );
  });

  it('仓库关闭钉钉时跳过', async () => {
    const s = session({
      repository: { ...session().repository!, enableDingtalk: false },
    });

    await expect(notifyReviewCompleted(s, messages)).resolves.toBe('skipped');
    expect(sendDingtalk).not.toHaveBeenCalled();
  });
});
