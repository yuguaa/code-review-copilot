import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UIMessage } from 'ai';
import { verifiedReviewPartKind } from '../../../shared/review-findings';
import {
  buildVerifiedMemoryEntry,
  mergeVerifiedReviewMemory,
  notifyReviewCompleted,
  publishReviewComment,
  rememberVerifiedReview,
  runReviewCompletionIntegrations,
} from './review-notification';
import { sendRepositoryDingtalkNotification } from '../notifications/notifications.service';
import { readRepositoryMemory, writeRepositoryMemory } from '../repositories/repositories.service';
import type { SessionWithRepository } from '../sessions/session-message-store.service';

vi.mock('../notifications/notifications.service', () => ({
  sendRepositoryDingtalkNotification: vi.fn().mockResolvedValue('sent'),
}));

vi.mock('../repositories/repositories.service', () => ({
  readRepositoryMemory: vi.fn().mockResolvedValue('## 既有记忆\n- 保留'),
  writeRepositoryMemory: vi.fn().mockResolvedValue(undefined),
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

function messagePart(value: unknown): UIMessage['parts'][number] {
  return value as UIMessage['parts'][number];
}

describe('notifyReviewCompleted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('仓库开启钉钉且全局配置存在时发送完成通知', async () => {
    const s = session();
    await expect(notifyReviewCompleted(s, messages)).resolves.toBe('sent');
    expect(sendRepositoryDingtalkNotification).toHaveBeenCalledWith(
      s.repository,
      expect.stringContaining('polit-agent'),
      expect.stringContaining('审查通过。'),
    );
  });

  it('没有 assistant 文本时仍发送完成通知', async () => {
    await notifyReviewCompleted(session(), [{ id: 'm1', role: 'assistant', parts: [{ type: 'step-start' }] } as UIMessage]);
    expect(sendRepositoryDingtalkNotification).toHaveBeenCalledWith(
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
    expect(sendRepositoryDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.not.stringContaining('旧回复'),
    );
    expect(sendRepositoryDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.stringContaining('最新首答'),
    );
  });

  it('有 Verify 结论时钉钉正文只发送最终核验结果', async () => {
    await notifyReviewCompleted(session(), [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: '未验证草稿' },
          messagePart({
            type: 'tool-bash',
            state: 'output-available',
            toolCallId: 'tool-1',
            input: { command: 'git diff' },
            output: 'diff output',
          }),
          messagePart({
            type: 'text',
            text: '## Verify 结论\nverified 总评',
            reviewPartKind: verifiedReviewPartKind,
          }),
        ],
      },
    ]);

    expect(sendRepositoryDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.stringContaining('## Verify 结论\nverified 总评'),
    );
    expect(sendRepositoryDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.not.stringContaining('未验证草稿'),
    );
  });

  it('有 Verify 结论时不再发送可能已被推翻的平台总评', async () => {
    await notifyReviewCompleted(session(), [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: '我会先读取项目记忆和本次 diff。' },
          messagePart({
            type: 'tool-post_review_comment',
            state: 'output-available',
            toolCallId: 'tool-1',
            input: { markdown: '## 严重\n- Dockerfile:12 构建产物路径错误，会导致镜像构建失败。' },
            output: { posted: true },
          }),
          messagePart({
            type: 'text',
            text: '## Verify 结论\nverified 总评',
            reviewPartKind: verifiedReviewPartKind,
          }),
        ],
      },
    ]);

    expect(sendRepositoryDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.not.stringContaining('Dockerfile:12 构建产物路径错误'),
    );
    expect(sendRepositoryDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.stringContaining('## Verify 结论\nverified 总评'),
    );
    expect(sendRepositoryDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.not.stringContaining('我会先读取项目记忆'),
    );
  });

  it('优先把 post_review_comment 的 markdown 作为钉钉正文', async () => {
    await notifyReviewCompleted(session(), [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: '我会先读取项目记忆和本次 diff。' },
          messagePart({
            type: 'tool-post_review_comment',
            state: 'output-available',
            toolCallId: 'tool-1',
            input: { markdown: '## 严重\n- Dockerfile:12 构建产物路径错误，会导致镜像构建失败。' },
            output: { posted: true },
          }),
          { type: 'text', text: '总评已发布。我会把这次得到的部署审查要点沉淀到项目记忆。' },
        ],
      },
    ]);

    expect(sendRepositoryDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.stringContaining('Dockerfile:12 构建产物路径错误'),
    );
    expect(sendRepositoryDingtalkNotification).toHaveBeenCalledWith(
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
          messagePart({
            type: 'tool-post_inline_comment',
            state: 'output-available',
            toolCallId: 'tool-1',
            input: {
              path: 'Dockerfile',
              line: 12,
              body: '构建产物路径与根 build:all 契约不一致，会导致镜像构建失败。',
            },
            output: { posted: true },
          }),
          messagePart({
            type: 'tool-post_inline_comment',
            state: 'output-available',
            toolCallId: 'tool-2',
            input: {
              path: 'Dockerfile',
              line: 1,
              body: '基础镜像使用 latest，发布不可复现且难以审计。',
            },
            output: { posted: true },
          }),
          { type: 'text', text: '行级评论已发布。现在整理总评。' },
        ],
      },
    ]);

    expect(sendRepositoryDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.stringContaining('Dockerfile:12'),
    );
    expect(sendRepositoryDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.stringContaining('构建产物路径与根 build:all 契约不一致'),
    );
    expect(sendRepositoryDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.stringContaining('Dockerfile:1'),
    );
    expect(sendRepositoryDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.not.stringContaining('我会先读取项目记忆'),
    );
  });

  it('有总评评论时仍把行级问题附加到钉钉正文', async () => {
    await notifyReviewCompleted(session(), [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          messagePart({
            type: 'tool-post_inline_comment',
            state: 'output-available',
            toolCallId: 'tool-1',
            input: {
              path: 'Dockerfile',
              line: 12,
              body: '构建产物路径与根 build:all 契约不一致，会导致镜像构建失败。',
            },
            output: { posted: true },
          }),
          messagePart({
            type: 'tool-post_review_comment',
            state: 'output-available',
            toolCallId: 'tool-2',
            input: { markdown: '## 总评\n本次变更存在部署风险。' },
            output: { posted: true },
          }),
        ],
      },
    ]);

    expect(sendRepositoryDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.stringContaining('## 总评'),
    );
    expect(sendRepositoryDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.stringContaining('## 行级问题'),
    );
    expect(sendRepositoryDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.stringContaining('Dockerfile:12'),
    );
  });

  it('兼容 args 形态的行级工具调用参数', async () => {
    await notifyReviewCompleted(session(), [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          messagePart({
            type: 'tool-post_inline_comment',
            state: 'output-available',
            toolCallId: 'tool-1',
            args: {
              path: 'nginx.conf',
              line: 8,
              body: '子路径部署缺少静态资源路径校验，可能导致白屏。',
            },
            output: { posted: true },
          }),
          { type: 'text', text: '行级评论已发布。现在整理总评。' },
        ],
      },
    ]);

    expect(sendRepositoryDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.stringContaining('nginx.conf:8'),
    );
    expect(sendRepositoryDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.not.stringContaining('行级评论已发布'),
    );
  });

  it('仓库关闭钉钉时跳过', async () => {
    const s = session({
      repository: { ...session().repository!, enableDingtalk: false },
    });

    await expect(notifyReviewCompleted(s, messages)).resolves.toBe('skipped');
    expect(sendRepositoryDingtalkNotification).not.toHaveBeenCalled();
  });
});

describe('publishReviewComment', () => {
  it('MR 会话发布 verified 总评', async () => {
    const gitlab = {
      createMergeRequestComment: vi.fn().mockResolvedValue({ id: 'discussion-1' }),
    };

    await expect(
      publishReviewComment(
        {
          gitlab: gitlab as never,
          projectId: 1,
          mrIid: 2,
          repoId: 'r1',
          workdir: '/tmp/repo',
          diffRef: 'origin/main',
          commitSha: 'head',
          diffRefs: null,
          enableMrComment: true,
          dingtalkRepository: { enableDingtalk: false, dingtalkWebhook: null, dingtalkSecret: null },
        },
        'verified 总评',
      ),
    ).resolves.toBe('posted');

    expect(gitlab.createMergeRequestComment).toHaveBeenCalledWith(1, 2, 'verified 总评');
  });

  it('关闭平台评论时跳过发布', async () => {
    const gitlab = {
      createMergeRequestComment: vi.fn(),
    };

    await expect(
      publishReviewComment(
        {
          gitlab: gitlab as never,
          projectId: 1,
          mrIid: 2,
          repoId: 'r1',
          workdir: '/tmp/repo',
          diffRef: 'origin/main',
          commitSha: 'head',
          diffRefs: null,
          enableMrComment: false,
          dingtalkRepository: { enableDingtalk: false, dingtalkWebhook: null, dingtalkSecret: null },
        },
        'verified 总评',
      ),
    ).resolves.toBe('skipped');

    expect(gitlab.createMergeRequestComment).not.toHaveBeenCalled();
  });
});

describe('verified review memory', () => {
  it('把 verified 审查结论合并到固定记忆分组', () => {
    const entry = buildVerifiedMemoryEntry('## 严重\n- a.ts:1 问题：x');

    expect(entry).toContain('verified 审查结论');
    expect(mergeVerifiedReviewMemory('## 既有记忆\n- 保留', entry)).toContain('## Verified 审查沉淀');
    expect(mergeVerifiedReviewMemory('（暂无项目记忆）', entry)).toBe(`## Verified 审查沉淀\n${entry}`);
  });

  it('verify 后由系统写入仓库记忆', async () => {
    await rememberVerifiedReview(
      {
        gitlab: {} as never,
        projectId: 1,
        mrIid: null,
        repoId: 'r1',
        workdir: '/tmp/repo',
        diffRef: 'origin/main',
        commitSha: 'head',
        diffRefs: null,
        enableMrComment: false,
        dingtalkRepository: { enableDingtalk: false, dingtalkWebhook: null, dingtalkSecret: null },
      },
      'verified 总评',
    );

    expect(readRepositoryMemory).toHaveBeenCalledWith('r1');
    expect(writeRepositoryMemory).toHaveBeenCalledWith(
      'r1',
      expect.stringContaining('verified 总评'),
    );
  });
});

describe('runReviewCompletionIntegrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('单个外部渠道失败时仍完成其它集成并返回失败明细', async () => {
    const gitlab = {
      createMergeRequestComment: vi.fn().mockResolvedValue({ id: 'discussion-1' }),
    };
    vi.mocked(sendRepositoryDingtalkNotification).mockRejectedValueOnce(new Error('钉钉不可用'));

    const failures = await runReviewCompletionIntegrations(
      {
        gitlab: gitlab as never,
        projectId: 1,
        mrIid: 2,
        repoId: 'r1',
        workdir: '/tmp/repo',
        diffRef: 'origin/main',
        commitSha: 'head',
        diffRefs: null,
        enableMrComment: true,
        dingtalkRepository: { enableDingtalk: true, dingtalkWebhook: null, dingtalkSecret: null },
      },
      session({ mrIid: 2 }),
      messages,
      'verified 总评',
    );

    expect(failures).toEqual([{ integration: 'dingtalk', error: expect.any(Error) }]);
    expect(gitlab.createMergeRequestComment).toHaveBeenCalledWith(1, 2, 'verified 总评');
    expect(writeRepositoryMemory).toHaveBeenCalled();
  });

  it('Verify 未产出结论时发布主审查结果且不写入 verified 记忆', async () => {
    const gitlab = {
      createMergeRequestComment: vi.fn().mockResolvedValue({ id: 'discussion-1' }),
    };

    const failures = await runReviewCompletionIntegrations(
      {
        gitlab: gitlab as never,
        projectId: 1,
        mrIid: 2,
        repoId: 'r1',
        workdir: '/tmp/repo',
        diffRef: 'origin/main',
        commitSha: 'head',
        diffRefs: null,
        enableMrComment: true,
        dingtalkRepository: { enableDingtalk: true, dingtalkWebhook: null, dingtalkSecret: null },
      },
      session({ mrIid: 2 }),
      messages,
      null,
    );

    expect(failures).toEqual([]);
    expect(gitlab.createMergeRequestComment).toHaveBeenCalledWith(1, 2, '审查通过。');
    expect(sendRepositoryDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.stringContaining('审查通过。'),
    );
    expect(writeRepositoryMemory).not.toHaveBeenCalled();
  });

  it('单个发布渠道同步抛错时仍完成其它渠道', async () => {
    const gitlab = {
      createMergeRequestComment: vi.fn(() => {
        throw new Error('GitLab 不可用');
      }),
    };

    const failures = await runReviewCompletionIntegrations(
      {
        gitlab: gitlab as never,
        projectId: 1,
        mrIid: 2,
        repoId: 'r1',
        workdir: '/tmp/repo',
        diffRef: 'origin/main',
        commitSha: 'head',
        diffRefs: null,
        enableMrComment: true,
        dingtalkRepository: { enableDingtalk: true, dingtalkWebhook: null, dingtalkSecret: null },
      },
      session({ mrIid: 2 }),
      messages,
      null,
    );

    expect(failures).toEqual([{ integration: 'gitlab', error: expect.any(Error) }]);
    expect(sendRepositoryDingtalkNotification).toHaveBeenCalled();
  });
});
