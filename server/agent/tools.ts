import { tool } from 'ai';
import { z } from 'zod';
import { createGitLabService, type GitLabService } from '../lib/gitlab';
import type { SessionWithRepository } from '../lib/chat-store';

const MAX_CHARS = 30_000; // 单次工具返回的字符上限，避免撑爆上下文

function truncate(text: string): string {
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n…(已截断，共 ${text.length} 字符)` : text;
}

/** 审查上下文：一次审查/会话锁定的 GitLab 项目与 MR 信息。 */
export type ReviewContext = {
  gitlab: GitLabService;
  projectId: number;
  mrIid: number | null;
  ref: string; // 读文件默认 ref
  sourceBranch: string | null;
  targetBranch: string | null;
};

/** 从会话构造审查上下文（会话必须绑定仓库）。 */
export function buildReviewContext(session: SessionWithRepository): ReviewContext {
  const repo = session.repository;
  if (!repo) throw new Error('会话未绑定仓库，无法构造审查上下文');
  return {
    gitlab: createGitLabService(repo.gitLabAccount.url, repo.gitLabAccount.accessToken),
    projectId: repo.gitLabProjectId,
    mrIid: session.mrIid,
    ref: session.commitSha ?? session.sourceBranch ?? 'HEAD',
    sourceBranch: session.sourceBranch,
    targetBranch: session.targetBranch,
  };
}

const NO_MR = '当前会话未绑定 Merge Request，无法获取变更/diff，请改用 read_file 按需读取文件。';

/** 只读工具集（列变更 / 拉 diff / 读文件）——主 agent 与各 subagent 共用。 */
export function buildReadTools(ctx: ReviewContext) {
  return {
    list_changed_files: tool({
      description: '列出本次 Merge Request 的所有变更文件（路径与新增/删除/重命名标记）。审查的第一步通常先调它。',
      inputSchema: z.object({}),
      execute: async () => {
        if (ctx.mrIid == null) return NO_MR;
        const changes = await ctx.gitlab.getMergeRequestChanges(ctx.projectId, ctx.mrIid);
        return changes.map((d) => ({
          path: d.new_path,
          oldPath: d.old_path,
          newFile: d.new_file,
          deletedFile: d.deleted_file,
          renamedFile: d.renamed_file,
        }));
      },
    }),

    fetch_diff: tool({
      description: '获取本次 MR 的代码 diff。可传 paths 只取指定文件；不传则返回全部变更的 diff。',
      inputSchema: z.object({
        paths: z.array(z.string()).optional().describe('只取这些文件路径的 diff（new_path）'),
      }),
      execute: async ({ paths }) => {
        if (ctx.mrIid == null) return NO_MR;
        const changes = await ctx.gitlab.getMergeRequestChanges(ctx.projectId, ctx.mrIid);
        const picked = paths?.length
          ? changes.filter((d) => paths.includes(d.new_path) || paths.includes(d.old_path))
          : changes;
        const text = picked
          .map((d) => `### ${d.new_path}${d.deleted_file ? ' (deleted)' : ''}\n\`\`\`diff\n${d.diff}\n\`\`\``)
          .join('\n\n');
        return truncate(text || '（无匹配的变更文件）');
      },
    }),

    read_file: tool({
      description: '读取仓库中某个文件的完整内容（用于理解变更的跨行/跨文件上下文）。ref 不传则用本次审查的提交。',
      inputSchema: z.object({
        path: z.string().describe('文件路径，如 src/app.ts'),
        ref: z.string().optional().describe('分支或 commit，不传用默认审查 ref'),
      }),
      execute: async ({ path, ref }) => {
        try {
          const content = await ctx.gitlab.getRepositoryFileRaw(ctx.projectId, path, ref ?? ctx.ref);
          return truncate(content);
        } catch {
          return `读取文件失败：${path}（ref=${ref ?? ctx.ref}），可能路径或 ref 不存在。`;
        }
      },
    }),

  };
}

/** 主 agent 工具集 = 只读工具 + 发布评论。 */
export function buildTools(ctx: ReviewContext) {
  return {
    ...buildReadTools(ctx),
    post_review_comment: tool({
      description:
        '把审查结论作为一条总评发布到 MR（Markdown）。在你完成审查、整理好所有问题后调用一次。返回 discussion id。',
      inputSchema: z.object({
        markdown: z.string().describe('完整的 Markdown 审查评论，按严重级别分组列出问题与建议'),
      }),
      execute: async ({ markdown }) => {
        if (ctx.mrIid == null) return NO_MR;
        const res = await ctx.gitlab.createMergeRequestComment(ctx.projectId, ctx.mrIid, markdown);
        return { posted: true, discussionId: (res as { id?: string }).id ?? null };
      },
    }),
  };
}

export type ReviewTools = ReturnType<typeof buildTools>;
