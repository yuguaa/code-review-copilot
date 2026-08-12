import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('notifyReviewCompleted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('仓库开启钉钉且全局配置存在时发送完成通知', async () => {
    const s = session();
    await expect(notifyReviewCompleted(s, '审查通过。')).resolves.toBe('sent');
    expect(sendRepositoryDingtalkNotification).toHaveBeenCalledWith(
      s.repository,
      expect.stringContaining('polit-agent'),
      expect.stringContaining('审查通过。'),
    );
  });

  it('只发送调用方显式选择的最终总评', async () => {
    await notifyReviewCompleted(session(), '## Verify 结论\nverified 总评');
    expect(sendRepositoryDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.stringContaining('## Verify 结论\nverified 总评'),
    );
  });

  it('仓库关闭钉钉时跳过', async () => {
    const s = session({
      repository: { ...session().repository!, enableDingtalk: false },
    });

    await expect(notifyReviewCompleted(s, '审查通过。')).resolves.toBe('skipped');
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
      'verified 总评',
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
      '审查通过。',
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

  it('GitLab 与钉钉消费同一个显式最终总评，不混入过程文本', async () => {
    const gitlab = {
      createCommitComment: vi.fn().mockResolvedValue({ id: 'note-1' }),
    };
    const publicationText = '## 严重\n未发现严重问题。\n\n## 一般\n未发现一般问题。\n\n## 建议\n暂无建议。';

    await runReviewCompletionIntegrations(
      {
        gitlab: gitlab as never,
        projectId: 1,
        mrIid: null,
        repoId: 'r1',
        workdir: '/tmp/repo',
        diffRef: 'base',
        commitSha: 'head',
        diffRefs: null,
        enableMrComment: true,
        dingtalkRepository: { enableDingtalk: true, dingtalkWebhook: null, dingtalkSecret: null },
      },
      session(),
      publicationText,
      null,
    );

    expect(gitlab.createCommitComment).toHaveBeenCalledWith(1, 'head', publicationText);
    expect(sendRepositoryDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.stringContaining(publicationText),
    );
    expect(sendRepositoryDingtalkNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.not.stringContaining('现在深入查看相关源码文件'),
    );
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
      '审查通过。',
      null,
    );

    expect(failures).toEqual([{ integration: 'gitlab', error: expect.any(Error) }]);
    expect(sendRepositoryDingtalkNotification).toHaveBeenCalled();
  });
});
