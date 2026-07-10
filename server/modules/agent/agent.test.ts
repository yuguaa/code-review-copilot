import { describe, it, expect, vi } from 'vitest';
import {
  modelEndpointKey,
  resolveModel,
  resolveRepositoryModelConfig,
  resolveReviewModelConfigs,
} from '../ai-models/ai-models.service';
import { buildPublishTools, buildTools, type ReviewContext } from './tools';
import { buildInstructions, hasDelegateToolsAvailable } from './review-agent';
import { buildDelegateTools } from './subagents';
import type { ReviewBlueprint } from './review-blueprint';
import { createReviewRuntimeMemory } from './review-runtime-memory';
import { signedUrl } from '../../shared/dingtalk/dingtalk.service';
import type { GitLabService } from '../../shared/gitlab/gitlab.service';
import type { SessionWithRepository } from '../sessions/session-message-store.service';
import { sendRepositoryDingtalkNotification } from '../notifications/notifications.service';

vi.mock('../notifications/notifications.service', () => ({
  sendRepositoryDingtalkNotification: vi.fn().mockResolvedValue('sent'),
}));

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

  it('仓库绑定模型已停用时回退到全局默认模型', () => {
    expect(
      resolveRepositoryModelConfig(
        repo({
          defaultAIModelId: 'repo-model',
          defaultAIModel: model({ id: 'repo-model', provider: 'openai', modelId: 'gpt-4o', apiKey: 'repo-key', isActive: false }),
        }),
        model({ id: 'global-model', modelId: 'global-model' }),
      ),
    ).toMatchObject({ provider: 'openai-compatible', modelId: 'global-model', apiKey: 'global-key' });
  });

  it('全局默认模型已停用时快速失败', () => {
    expect(() => resolveRepositoryModelConfig(repo(), model({ isActive: false }))).toThrow('全局默认模型已停用');
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

describe('resolveReviewModelConfigs', () => {
  it('主审查使用仓库模型，Verify 使用去重后的多模型池', () => {
    const repoModel = model({ id: 'repo-model', provider: 'openai', modelId: 'gpt-4o', apiKey: 'repo-key' });
    const configs = resolveReviewModelConfigs(
      repo({ defaultAIModelId: 'repo-model', defaultAIModel: repoModel }),
      model({ id: 'global-model', modelId: 'global-model' }),
      [
        { provider: 'openai', modelId: 'gpt-4o', apiKey: 'repo-key', apiBaseUrl: 'https://example.com/v1', maxSteps: 16 },
        { provider: 'anthropic', modelId: 'claude-sonnet-4', apiKey: 'verify-key', maxSteps: 12 },
      ],
    );

    expect(configs.primary).toMatchObject({ provider: 'openai', modelId: 'gpt-4o', apiKey: 'repo-key' });
    expect(configs.delegates).toHaveLength(2);
    expect(configs.verifiers).toEqual([
      expect.objectContaining({ provider: 'anthropic', modelId: 'claude-sonnet-4' }),
      expect.objectContaining({ provider: 'openai', modelId: 'gpt-4o' }),
    ]);
  });

  it('网关地址末尾斜杠不同仍视为同一个模型端点', () => {
    expect(modelEndpointKey({
      provider: 'openai-compatible',
      modelId: 'glm-code',
      apiBaseUrl: 'https://gateway.test/v1/',
    })).toBe(modelEndpointKey({
      provider: 'openai-compatible',
      modelId: 'glm-code',
      apiBaseUrl: 'https://gateway.test/v1',
    }));
  });

  it('只有一个可用模型时快速失败，不伪装成多模型 Verify', () => {
    expect(() => resolveReviewModelConfigs(repo(), model(), [])).toThrow(
      '多模型 Verify 至少需要配置两个不同的启用模型',
    );
  });

  it('存在两个非主模型时 Verify 不再复用主审查模型', () => {
    const primary = model({ id: 'primary', provider: 'openai', modelId: 'gpt-5', apiKey: 'primary-key' });
    const configs = resolveReviewModelConfigs(
      repo({ defaultAIModelId: 'primary', defaultAIModel: primary }),
      primary,
      [
        { provider: 'openai', modelId: 'gpt-5', apiKey: 'primary-key', apiBaseUrl: 'https://example.com/v1', maxSteps: 16 },
        { provider: 'openai-compatible', modelId: 'doubao-code', apiKey: 'doubao', apiBaseUrl: 'https://doubao.test/v1', maxSteps: 16 },
        { provider: 'openai-compatible', modelId: 'glm-code', apiKey: 'glm', apiBaseUrl: 'https://glm.test/v1', maxSteps: 16 },
      ],
    );

    expect(configs.verifiers.map((config) => config.modelId)).toEqual(['doubao-code', 'glm-code']);
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
  const context: ReviewContext = {
    gitlab,
    projectId: 1,
    mrIid: 42,
    repoId: 'r1',
    workdir: '/tmp/wt',
    diffRef: 'origin/main',
    commitSha: 'h',
    diffRefs: { base_sha: 'b', head_sha: 'h', start_sha: 's' },
    enableMrComment: true,
    dingtalkRepository: {
      enableDingtalk: true,
      dingtalkWebhook: 'https://dingtalk.example',
      dingtalkSecret: null,
    },
  };
  return { ...context, ...overrides };
}

describe('输出工具的开关控制', () => {
  it('开启时 post_review_comment 返回 discussionId', async () => {
    const tools = buildTools(fakeContext(), { publish: true });
    const out = (await tools.post_review_comment!.execute!({ markdown: '# 审查' }, toolOpts)) as {
      discussionId: string | number;
    };
    expect(out.discussionId).toBe('disc-1');
  });

  it('关闭平台评论时不提供发布工具', () => {
    const tools = buildTools(fakeContext({ enableMrComment: false }), { publish: true });
    expect('post_review_comment' in tools).toBe(false);
    expect('post_inline_comment' in tools).toBe(false);
    expect('write_memory' in tools).toBe(true);
  });

  it('行级评论缺 diff_refs 时提示', async () => {
    const tools = buildTools(fakeContext({ diffRefs: null }), { publish: true });
    const out = await tools.post_inline_comment!.execute!({ path: 'a.ts', line: 3, body: 'x' }, toolOpts);
    expect(out).toEqual({ posted: false, error: expect.stringContaining('diff_refs') });
  });

  it('行级评论携带 position 调用 GitLab', async () => {
    const ctx = fakeContext();
    const tools = buildTools(ctx, { publish: true });
    await tools.post_inline_comment!.execute!({ path: 'a.ts', line: 3, body: 'x' }, toolOpts);
    expect(ctx.gitlab.createMergeRequestComment).toHaveBeenCalledWith(
      1,
      42,
      'x',
      expect.objectContaining({ new_path: 'a.ts', new_line: 3, position_type: 'text', base_sha: 'b' }),
    );
  });

  it('追问首次发布行级评论时按需加载 MR diff_refs', async () => {
    const loadDiffRefs = vi.fn().mockResolvedValue({ base_sha: 'b2', head_sha: 'h2', start_sha: 's2' });
    const ctx = fakeContext({ diffRefs: null, loadDiffRefs });
    const tools = buildTools(ctx, { publish: true });

    await tools.post_inline_comment!.execute!({ path: 'src/a.ts', line: 8, body: '这里存在空指针。' }, toolOpts);

    expect(loadDiffRefs).toHaveBeenCalledOnce();
    expect(ctx.gitlab.createMergeRequestComment).toHaveBeenCalledWith(
      1,
      42,
      '这里存在空指针。',
      expect.objectContaining({ base_sha: 'b2', new_path: 'src/a.ts', new_line: 8 }),
    );
  });

  it('Push 会话评论发布到 commit', async () => {
    const ctx = fakeContext({ mrIid: null, diffRefs: null, commitSha: 'abc123' });
    const tools = buildTools(ctx, { publish: true });
    const out = (await tools.post_review_comment!.execute!({ markdown: '# 审查' }, toolOpts)) as {
      noteId: string | number;
    };
    expect(out.noteId).toBe('note-1');
    expect(ctx.gitlab.createCommitComment).toHaveBeenCalledWith(1, 'abc123', '# 审查');
  });

  it('开启钉钉渠道时发送用户指定内容', async () => {
    const ctx = fakeContext();
    const tools = buildTools(ctx, { publish: true });
    const out = await tools.send_dingtalk_notification!.execute!(
      { title: '复核结论', markdown: '已确认 2 个问题。' },
      toolOpts,
    );

    expect(out).toEqual({ sent: true, result: 'sent' });
    expect(sendRepositoryDingtalkNotification).toHaveBeenCalledWith(
      ctx.dingtalkRepository,
      '复核结论',
      '已确认 2 个问题。',
    );
  });

  it('关闭钉钉渠道时不提供发送工具', () => {
    const tools = buildTools(fakeContext({
      dingtalkRepository: { enableDingtalk: false, dingtalkWebhook: null, dingtalkSecret: null },
    }), { publish: true });

    expect('send_dingtalk_notification' in tools).toBe(false);
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

  it('没有服务端发布授权时不挂载任何发布工具', () => {
    expect(Object.keys(buildPublishTools(fakeContext(), new Set()))).toEqual([]);
  });

  it('草稿审查 loop 可关闭写记忆工具，避免 verify 前副作用', () => {
    const tools = buildTools(fakeContext(), { publish: false, memoryWrite: false });
    expect('post_review_comment' in tools).toBe(false);
    expect('post_inline_comment' in tools).toBe(false);
    expect('send_dingtalk_notification' in tools).toBe(false);
    expect('write_memory' in tools).toBe(false);
    expect('read_memory' in tools).toBe(true);
  });

  it('record_evidence 只写运行期 CodeMem，不开启长期记忆写入', async () => {
    const runtimeMemory = createReviewRuntimeMemory();
    const tools = buildTools(fakeContext({ runtimeMemory }), { publish: false, memoryWrite: false });

    expect('write_memory' in tools).toBe(false);
    expect('record_evidence' in tools).toBe(true);
    await tools.record_evidence!.execute!({ evidence: 'review-agent.ts:12 蓝图输入' }, toolOpts);
    expect(runtimeMemory.evidenceItems).toEqual(['review-agent.ts:12 蓝图输入']);
  });

  it('没有启用模型池时不暴露专项委派工具', () => {
    const tools = buildDelegateTools(fakeContext(), []);
    expect(Object.keys(tools)).toEqual([]);
    expect(hasDelegateToolsAvailable(undefined, 0)).toBe(false);
  });
});

describe('buildInstructions（输出渠道按配置生成）', () => {
  it('开启平台评论与钉钉时，指令说明验证后由系统发布', () => {
    const text = buildInstructions(repo({ enableMrComment: true, enableDingtalk: true }));
    expect(text).toContain('不要自行发布评论');
    expect(text).toContain('系统会在 verify loop 通过后');
    expect(text).toContain('自动推送钉钉');
    expect(text).toContain('verify loop');
  });

  it('关闭平台评论与钉钉时，指令不出现任何发布渠道', () => {
    const text = buildInstructions(repo({ enableMrComment: false, enableDingtalk: false }));
    expect(text).not.toContain('post_review_comment');
    expect(text).not.toContain('post_inline_comment');
    expect(text).not.toContain('钉钉');
    expect(text).toContain('审查结论会展示在会话页面');
  });

  it('只把达到阈值的用户反馈沉淀作为后续审查依据', () => {
    const text = buildInstructions(repo());
    expect(text).toContain('用户反馈阈值沉淀');
    expect(text).toContain('单次 findingFeedbacks 不是证据');
    expect(text).toContain('用户认可的问题模式');
    expect(text).toContain('用户否定的问题模式');
    expect(text).toContain('不要机械复读');
    expect(text).toContain('不要写项目记忆');
  });

  it('主审查 prompt 消费审查蓝图与运行期 CodeMem', () => {
    const blueprint: ReviewBlueprint = {
      scope: ['server/modules/agent/review-agent.ts'],
      riskAreas: ['多智能体流程变化'],
      requiredEvidence: ['核验 verify 前无副作用'],
      delegatePlan: ['architecture'],
      verificationChecklist: ['对照蓝图逐条删除无证据问题'],
    };
    const runtimeMemory = createReviewRuntimeMemory();
    const text = buildInstructions(repo(), [], blueprint, runtimeMemory);

    expect(text).toContain('DeepCode 风格链路');
    expect(text).toContain('审查蓝图');
    expect(text).toContain('运行期 CodeMem');
    expect(text).toContain('record_evidence');
    expect(text).toContain('只有蓝图中安全/架构/性能风险明确且复杂时才调用');
  });

  it('没有启用专项模型时 prompt 不声明 delegate 工具', () => {
    const text = buildInstructions(repo(), [], undefined, undefined, { delegateToolsAvailable: false });
    expect(text).not.toContain('delegate_security');
    expect(text).toContain('当前没有启用的专项审查模型');
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
