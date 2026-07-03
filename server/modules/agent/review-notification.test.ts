import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UIMessage } from 'ai';
import { notifyReviewCompleted } from './review-notification';
import { sendReviewDingtalkNotification } from '../notifications/notifications.service';
import type { SessionWithRepository } from '../sessions/session-message-store.service';

vi.mock('../notifications/notifications.service', () => ({
  sendReviewDingtalkNotification: vi.fn().mockResolvedValue('sent'),
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
    const s = session();
    await expect(notifyReviewCompleted(s, messages)).resolves.toBe('sent');
    expect(sendReviewDingtalkNotification).toHaveBeenCalledWith(
      s.repository,
      expect.stringContaining('polit-agent'),
      expect.stringContaining('审查通过。'),
    );
  });

  it('没有 assistant 文本时仍发送完成通知', async () => {
    await notifyReviewCompleted(session(), [{ id: 'm1', role: 'assistant', parts: [{ type: 'step-start' }] } as UIMessage]);
    expect(sendReviewDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.stringContaining('模型没有返回可展示的文本结果'),
    );
  });

  it('只把最后一条 assistant 文本作为完成通知正文', async () => {
    await notifyReviewCompleted(session(), [
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: '旧回复' }] },
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: '追问' }] },
      { id: 'a2', role: 'assistant', parts: [{ type: 'text', text: '最新首答' }] },
    ]);
    expect(sendReviewDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.not.stringContaining('旧回复'),
    );
    expect(sendReviewDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.stringContaining('最新首答'),
    );
  });

  it('优先把 post_review_comment 的 markdown 作为钉钉正文', async () => {
    await notifyReviewCompleted(session(), [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: '我会先读取项目记忆和本次 diff。' },
          {
            type: 'tool-post_review_comment',
            state: 'output-available',
            toolCallId: 'tool-1',
            input: { markdown: '## 严重\n- Dockerfile:12 构建产物路径错误，会导致镜像构建失败。' },
            output: { posted: true },
          } as UIMessage['parts'][number],
          { type: 'text', text: '总评已发布。我会把这次得到的部署审查要点沉淀到项目记忆。' },
        ],
      },
    ]);

    expect(sendReviewDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.stringContaining('Dockerfile:12 构建产物路径错误'),
    );
    expect(sendReviewDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.not.stringContaining('我会先读取项目记忆'),
    );
  });

  it('没有总评评论时把行级问题汇总到钉钉正文', async () => {
    await notifyReviewCompleted(session(), [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: '我会先读取项目记忆和本次 diff。' },
          {
            type: 'tool-post_inline_comment',
            state: 'output-available',
            toolCallId: 'tool-1',
            input: {
              path: 'Dockerfile',
              line: 12,
              body: '构建产物路径与根 build:all 契约不一致，会导致镜像构建失败。',
            },
            output: { posted: true },
          } as UIMessage['parts'][number],
          {
            type: 'tool-post_inline_comment',
            state: 'output-available',
            toolCallId: 'tool-2',
            input: {
              path: 'Dockerfile',
              line: 1,
              body: '基础镜像使用 latest，发布不可复现且难以审计。',
            },
            output: { posted: true },
          } as UIMessage['parts'][number],
          { type: 'text', text: '行级评论已发布。现在整理总评。' },
        ],
      },
    ]);

    expect(sendReviewDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.stringContaining('Dockerfile:12'),
    );
    expect(sendReviewDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.stringContaining('构建产物路径与根 build:all 契约不一致'),
    );
    expect(sendReviewDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.stringContaining('Dockerfile:1'),
    );
    expect(sendReviewDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.not.stringContaining('我会先读取项目记忆'),
    );
  });

  it('仓库关闭钉钉时跳过', async () => {
    const s = session({
      repository: { ...session().repository!, enableDingtalk: false },
    });

    await expect(notifyReviewCompleted(s, messages)).resolves.toBe('skipped');
    expect(sendReviewDingtalkNotification).not.toHaveBeenCalled();
  });
});
