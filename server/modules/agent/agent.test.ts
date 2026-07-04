import { describe, it, expect, vi } from 'vitest';
import { resolveModel, resolveRepositoryModelConfig } from '../ai-models/ai-models.service';
import { buildTools, type ReviewContext } from './tools';
import { buildInstructions } from './review-agent';
import { signedUrl } from '../../shared/dingtalk/dingtalk.service';
import type { GitLabService } from '../../shared/gitlab/gitlab.service';
import type { SessionWithRepository } from '../sessions/session-message-store.service';

// 工具执行时 AI SDK 传入的 options（这里只需占位）。
const toolOpts = { toolCallId: 't1', messages: [] } as never;

describe('resolveModel', () => {
  it('缺配置/缺 key/未知 provider 时快速失败', () => {
    expect(() => resolveModel(null)).toThrow();
    expect(() => resolveModel({ provider: 'openai', modelId: 'gpt-4o', apiKey: '', maxSteps: 16 })).toThrow();
    expect(() => resolveModel({ provider: 'unknown', modelId: 'x', apiKey: 'k', maxSteps: 16 })).toThrow();
  });

  it('openai-compatible 缺 baseUrl 抛错，齐全则返回模型', () => {
    expect(() => resolveModel({ provider: 'openai-compatible', modelId: 'm', apiKey: 'k', maxSteps: 16 })).toThrow();
    const model = resolveModel({
      provider: 'openai-compatible',
      modelId: 'm',
      apiKey: 'k',
      apiBaseUrl: 'https://example.com/v1',
      maxSteps: 16,
    });
    expect(model).toBeTruthy();
  });
});

type RepoForModel = SessionWithRepository['repository'];
type GlobalModel = NonNullable<RepoForModel>['defaultAIModel'];

function model(overrides: Partial<NonNullable<GlobalModel>> = {}): NonNullable<GlobalModel> {
  return {
    id: 'm1',
    provider: 'openai-compatible',
    modelId: 'glm-5.2',
    apiKey: 'global-key',
    apiBaseUrl: 'https://example.com/v1',
    maxSteps: 16,
    isDefault: true,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function repo(overrides: Partial<NonNullable<RepoForModel>> = {}): NonNullable<RepoForModel> {
  return {
    id: 'r1',
    gitLabAccountId: 'g1',
    gitLabAccount: { id: 'g1', url: 'https://gitlab.example.com', accessToken: 'token', webhookSecret: null, isActive: true, createdAt: new Date(), updatedAt: new Date() },
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
    ...overrides,
  };
}

describe('resolveRepositoryModelConfig', () => {
  it('仓库未绑定模型时使用全局默认模型', () => {
    expect(resolveRepositoryModelConfig(repo(), model())).toMatchObject({
      provider: 'openai-compatible',
      modelId: 'glm-5.2',
      apiKey: 'global-key',
      apiBaseUrl: 'https://example.com/v1',
      maxSteps: 16,
    });
  });

  it('仓库绑定模型优先于全局默认模型', () => {
    expect(
      resolveRepositoryModelConfig(
        repo({
          defaultAIModelId: 'repo-model',
          defaultAIModel: model({ id: 'repo-model', provider: 'openai', modelId: 'gpt-4o', apiKey: 'repo-key' }),
        }),
        model({ id: 'global-model', modelId: 'global-model' }),
      ),
    ).toMatchObject({ provider: 'openai', modelId: 'gpt-4o', apiKey: 'repo-key' });
  });

  it('仓库自定义模型优先于仓库绑定和全局默认模型', () => {
    expect(
      resolveRepositoryModelConfig(
        repo({
          customProvider: 'anthropic',
          customModelId: 'claude-sonnet-4',
          customApiKey: 'custom-key',
          customMaxSteps: 24,
          defaultAIModel: model({ id: 'repo-model', modelId: 'repo-model' }),
        }),
        model(),
      ),
    ).toMatchObject({ provider: 'anthropic', modelId: 'claude-sonnet-4', apiKey: 'custom-key', maxSteps: 24 });
  });
});

describe('signedUrl（钉钉加签）', () => {
  it('无 secret 时返回原始 webhook', () => {
    expect(signedUrl('https://oapi.dingtalk.com/robot/send?access_token=abc')).toBe(
      'https://oapi.dingtalk.com/robot/send?access_token=abc',
    );
  });

  it('有 secret 时追加 timestamp 与 sign', () => {
    const url = signedUrl('https://oapi.dingtalk.com/robot/send?access_token=abc', 'SECxx');
    expect(url).toMatch(/&timestamp=\d+&sign=/);
    // sign 经 urlencode 的 base64，解码后非空
    const sign = new URL(url).searchParams.get('sign');
    expect(sign && sign.length).toBeTruthy();
  });
});

function fakeContext(overrides: Partial<ReviewContext> = {}): ReviewContext {
  const gitlab = {
    createMergeRequestComment: vi.fn().mockResolvedValue({ id: 'disc-1' }),
    createCommitComment: vi.fn().mockResolvedValue({ id: 'note-1' }),
  } as unknown as GitLabService;
  return {
    gitlab,
    projectId: 1,
    mrIid: 42,
    repoId: 'r1',
    workdir: '/tmp/wt',
    diffRef: 'origin/main',
    commitSha: 'h',
    diffRefs: { base_sha: 'b', head_sha: 'h', start_sha: 's' },
    enableMrComment: true,
    ...overrides,
  };
}

describe('输出工具的开关控制', () => {
  it('开启时 post_review_comment 返回 discussionId', async () => {
    const tools = buildTools(fakeContext());
    const out = (await tools.post_review_comment!.execute!({ markdown: '# 审查' }, toolOpts)) as {
      discussionId: string | number;
    };
    expect(out.discussionId).toBe('disc-1');
  });

  it('关闭平台评论时不提供发布工具', () => {
    const tools = buildTools(fakeContext({ enableMrComment: false }));
    expect('post_review_comment' in tools).toBe(false);
    expect('post_inline_comment' in tools).toBe(false);
    expect('write_memory' in tools).toBe(true);
  });

  it('行级评论缺 diff_refs 时提示', async () => {
    const tools = buildTools(fakeContext({ diffRefs: null }));
    const out = await tools.post_inline_comment!.execute!({ path: 'a.ts', line: 3, body: 'x' }, toolOpts);
    expect(out).toContain('diff_refs');
  });

  it('行级评论携带 position 调用 GitLab', async () => {
    const ctx = fakeContext();
    const tools = buildTools(ctx);
    await tools.post_inline_comment!.execute!({ path: 'a.ts', line: 3, body: 'x' }, toolOpts);
    expect(ctx.gitlab.createMergeRequestComment).toHaveBeenCalledWith(
      1,
      42,
      'x',
      expect.objectContaining({ new_path: 'a.ts', new_line: 3, position_type: 'text', base_sha: 'b' }),
    );
  });

  it('Push 会话评论发布到 commit', async () => {
    const ctx = fakeContext({ mrIid: null, diffRefs: null, commitSha: 'abc123' });
    const tools = buildTools(ctx);
    const out = (await tools.post_review_comment!.execute!({ markdown: '# 审查' }, toolOpts)) as {
      noteId: string | number;
    };
    expect(out.noteId).toBe('note-1');
    expect(ctx.gitlab.createCommitComment).toHaveBeenCalledWith(1, 'abc123', '# 审查');
  });

  it('无 diff 基准（纯对话工作区）时不提供 git_diff 工具', () => {
    const tools = buildTools(fakeContext({ diffRef: null }));
    expect('git_diff' in tools).toBe(false);
    expect('bash' in tools).toBe(true);
    expect('read_memory' in tools).toBe(true);
  });

  it('仓库禁用工具时不暴露对应工具', () => {
    const tools = buildTools(fakeContext({ enabledTools: new Set(['read_file', 'read_memory']) }));
    expect('bash' in tools).toBe(false);
    expect('git_diff' in tools).toBe(false);
    expect('write_memory' in tools).toBe(false);
    expect('read_file' in tools).toBe(true);
  });
});

describe('buildInstructions（输出渠道按配置生成）', () => {
  it('开启平台评论与钉钉时，指令包含发布工具与钉钉说明', () => {
    const text = buildInstructions(repo({ enableMrComment: true, enableDingtalk: true }));
    expect(text).toContain('post_review_comment');
    expect(text).toContain('post_inline_comment');
    expect(text).toContain('自动推送钉钉');
  });

  it('关闭平台评论与钉钉时，指令不出现任何发布渠道', () => {
    const text = buildInstructions(repo({ enableMrComment: false, enableDingtalk: false }));
    expect(text).not.toContain('post_review_comment');
    expect(text).not.toContain('post_inline_comment');
    expect(text).not.toContain('钉钉');
    expect(text).toContain('审查结论会展示在会话页面');
  });

  it('明确使用用户反馈沉淀指导后续审查', () => {
    const text = buildInstructions(repo());
    expect(text).toContain('用户反馈沉淀');
    expect(text).toContain('用户认可的审查发现');
    expect(text).toContain('用户否定的审查发现');
    expect(text).toContain('不要机械复读');
  });

  it('仓库自定义审查要求追加在指令末尾', () => {
    const text = buildInstructions(repo({ defaultReviewPrompt: '重点关注鉴权' }));
    expect(text).toContain('本仓库的额外审查要求');
    expect(text).toContain('重点关注鉴权');
  });

  it('启用 brooks-lint skill 时追加 Iron Law 指令', () => {
    const text = buildInstructions(repo(), [
      {
        key: 'brooks-review',
        name: 'Brooks PR Review',
        description: 'x',
        mode: 'review',
        defaultEnabled: true,
        prompt: '必须按 brooks-lint 的 Iron Law 输出',
      },
    ]);
    expect(text).toContain('启用的仓库 Skills');
    expect(text).toContain('Brooks PR Review');
    expect(text).toContain('Iron Law');
  });
});
