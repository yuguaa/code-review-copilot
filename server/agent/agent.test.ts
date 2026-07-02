import { describe, it, expect, vi } from 'vitest';
import { resolveModel, resolveRepositoryModelConfig } from './model';
import { buildTools, isReadOnlyCommand, type ReviewContext } from './tools';
import { signedUrl } from '../lib/dingtalk';
import type { GitLabService } from '../lib/gitlab';
import type { SessionWithRepository } from '../lib/chat-store';

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

describe('isReadOnlyCommand（bash 安全门禁）', () => {
  it('放行只读命令与只读管道', () => {
    expect(isReadOnlyCommand('grep -n foo src')).toBe(true);
    expect(isReadOnlyCommand('rg -n TODO')).toBe(true);
    expect(isReadOnlyCommand('cat a.ts | head -20')).toBe(true);
    expect(isReadOnlyCommand('find . -name "*.ts"')).toBe(true);
    expect(isReadOnlyCommand('cat a 2>/dev/null')).toBe(true);
    expect(isReadOnlyCommand('git log --oneline -5')).toBe(true);
    expect(isReadOnlyCommand('git diff main...HEAD')).toBe(true);
  });

  it('拒绝写/网络/重定向/命令替换', () => {
    expect(isReadOnlyCommand('rm -rf /')).toBe(false);
    expect(isReadOnlyCommand('mv a b')).toBe(false);
    expect(isReadOnlyCommand('curl http://x')).toBe(false);
    expect(isReadOnlyCommand('npm install')).toBe(false);
    expect(isReadOnlyCommand('git push')).toBe(false);
    expect(isReadOnlyCommand('git commit -m x')).toBe(false);
    expect(isReadOnlyCommand('echo x > f')).toBe(false);
    expect(isReadOnlyCommand('cat $(whoami)')).toBe(false);
    expect(isReadOnlyCommand('grep foo `ls`')).toBe(false);
    expect(isReadOnlyCommand('cat a && rm b')).toBe(false);
    expect(isReadOnlyCommand('')).toBe(false);
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
    enableDingtalk: false,
    dingtalk: null,
    ...overrides,
  };
}

describe('输出工具的开关控制', () => {
  it('开启时 post_review_comment 返回 discussionId', async () => {
    const tools = buildTools(fakeContext());
    const out = (await tools.post_review_comment.execute!({ markdown: '# 审查' }, toolOpts)) as {
      discussionId: string | number;
    };
    expect(out.discussionId).toBe('disc-1');
  });

  it('关闭 MR 评论时跳过且不调用 GitLab', async () => {
    const ctx = fakeContext({ enableMrComment: false });
    const tools = buildTools(ctx);
    const out = await tools.post_review_comment.execute!({ markdown: 'x' }, toolOpts);
    expect(out).toContain('未开启');
    expect(ctx.gitlab.createMergeRequestComment).not.toHaveBeenCalled();
  });

  it('行级评论缺 diff_refs 时提示', async () => {
    const tools = buildTools(fakeContext({ diffRefs: null }));
    const out = await tools.post_inline_comment.execute!({ path: 'a.ts', line: 3, body: 'x' }, toolOpts);
    expect(out).toContain('diff_refs');
  });

  it('行级评论携带 position 调用 GitLab', async () => {
    const ctx = fakeContext();
    const tools = buildTools(ctx);
    await tools.post_inline_comment.execute!({ path: 'a.ts', line: 3, body: 'x' }, toolOpts);
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
    const out = (await tools.post_review_comment.execute!({ markdown: '# 审查' }, toolOpts)) as {
      noteId: string | number;
    };
    expect(out.noteId).toBe('note-1');
    expect(ctx.gitlab.createCommitComment).toHaveBeenCalledWith(1, 'abc123', '# 审查');
  });

  it('关闭钉钉时跳过推送', async () => {
    const tools = buildTools(fakeContext({ enableDingtalk: false }));
    const out = await tools.notify_dingtalk.execute!({ title: 't', text: 'x' }, toolOpts);
    expect(out).toContain('未开启');
  });
});
