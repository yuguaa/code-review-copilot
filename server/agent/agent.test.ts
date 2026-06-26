import { describe, it, expect, vi } from 'vitest';
import { resolveModel } from './model';
import { buildTools, buildReviewContext, type ReviewContext } from './tools';
import type { GitLabService } from '../lib/gitlab';

// 工具执行时 AI SDK 传入的 options（这里只需占位）。
const toolOpts = { toolCallId: 't1', messages: [] } as never;

describe('resolveModel', () => {
  it('缺配置/缺 key/未知 provider 时快速失败', () => {
    expect(() => resolveModel(null)).toThrow();
    expect(() => resolveModel({ modelProvider: 'openai', modelId: 'gpt-4o', apiKey: '' })).toThrow();
    expect(() =>
      resolveModel({ modelProvider: 'unknown', modelId: 'x', apiKey: 'k' }),
    ).toThrow();
  });

  it('openai-compatible 缺 baseUrl 抛错，齐全则返回模型', () => {
    expect(() =>
      resolveModel({ modelProvider: 'openai-compatible', modelId: 'm', apiKey: 'k' }),
    ).toThrow();
    const model = resolveModel({
      modelProvider: 'openai-compatible',
      modelId: 'm',
      apiKey: 'k',
      apiBaseUrl: 'https://example.com/v1',
    });
    expect(model).toBeTruthy();
  });
});

function fakeContext(overrides: Partial<ReviewContext> = {}): ReviewContext {
  const gitlab = {
    getMergeRequestChanges: vi.fn().mockResolvedValue([
      { new_path: 'a.ts', old_path: 'a.ts', new_file: false, deleted_file: false, renamed_file: false, diff: '@@ -1 +1 @@\n-old\n+new' },
      { new_path: 'b.ts', old_path: 'b.ts', new_file: true, deleted_file: false, renamed_file: false, diff: '@@ +1 @@\n+b' },
    ]),
    getRepositoryFileRaw: vi.fn().mockResolvedValue('file-content'),
    createMergeRequestComment: vi.fn().mockResolvedValue({ id: 'disc-1' }),
  } as unknown as GitLabService;
  return { gitlab, projectId: 1, mrIid: 42, ref: 'sha', sourceBranch: 'feat', targetBranch: 'main', ...overrides };
}

describe('buildTools', () => {
  it('list_changed_files 返回映射后的文件清单', async () => {
    const tools = buildTools(fakeContext());
    const out = await tools.list_changed_files.execute!({}, toolOpts);
    expect(out).toEqual([
      { path: 'a.ts', oldPath: 'a.ts', newFile: false, deletedFile: false, renamedFile: false },
      { path: 'b.ts', oldPath: 'b.ts', newFile: true, deletedFile: false, renamedFile: false },
    ]);
  });

  it('fetch_diff 按 paths 过滤', async () => {
    const tools = buildTools(fakeContext());
    const out = (await tools.fetch_diff.execute!({ paths: ['b.ts'] }, toolOpts)) as string;
    expect(out).toContain('b.ts');
    expect(out).not.toContain('a.ts');
  });

  it('read_file 返回内容', async () => {
    const tools = buildTools(fakeContext());
    const out = await tools.read_file.execute!({ path: 'a.ts' }, toolOpts);
    expect(out).toBe('file-content');
  });

  it('post_review_comment 返回 discussionId', async () => {
    const tools = buildTools(fakeContext());
    const out = (await tools.post_review_comment.execute!({ markdown: '# 审查' }, toolOpts)) as {
      discussionId: string;
    };
    expect(out.discussionId).toBe('disc-1');
  });

  it('无 MR 时变更类工具返回提示', async () => {
    const tools = buildTools(fakeContext({ mrIid: null }));
    const out = await tools.list_changed_files.execute!({}, toolOpts);
    expect(out).toContain('未绑定 Merge Request');
  });
});

describe('buildReviewContext', () => {
  it('从会话构造上下文，ref 优先取 commitSha', () => {
    const session = {
      mrIid: 7,
      commitSha: 'abc',
      sourceBranch: 'feat',
      targetBranch: 'main',
      repository: {
        gitLabProjectId: 99,
        gitLabAccount: { url: 'https://gitlab.com', accessToken: 'tok' },
      },
    } as never;
    const ctx = buildReviewContext(session);
    expect(ctx.projectId).toBe(99);
    expect(ctx.mrIid).toBe(7);
    expect(ctx.ref).toBe('abc');
  });
});
