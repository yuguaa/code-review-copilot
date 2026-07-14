import { tool } from 'ai';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createGitLabService, type GitLabService } from '../../shared/gitlab/gitlab.service';
import type { SessionWithRepository } from '../sessions/session-message-store.service';
import type { Workspace } from '../../infrastructure/workspace/workspace.service';
import type { ToolKey } from '../tools/tools.service';
import {
  readRepositoryMemory,
  writeRepositoryMemory,
} from '../repositories/repositories.service';
import { isReadOnlyCommand } from './read-only-command';
import { recordRuntimeEvidence, type ReviewRuntimeMemory } from './review-runtime-memory';
import {
  sendRepositoryDingtalkNotification,
  type DingtalkRepositoryConfig,
} from '../notifications/notifications.service';

const exec = promisify(execFile);
const MAX_CHARS = 30_000; // 单次工具返回上限，避免撑爆上下文
const CMD_TIMEOUT_MS = 30_000;

function truncate(text: string): string {
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n…(已截断，共 ${text.length} 字符)` : text;
}

/** 工作区上下文：只读探索工具需要的最小信息（审查与对话共用）。 */
export type WorkspaceContext = {
  repoId: string;
  workdir: string; // worktree 绝对路径，所有只读工具的 cwd
  diffRef: string | null; // git diff 基准（origin/main 或 Push before sha）；纯对话会话为 null
  enabledTools?: Set<ToolKey>;
};

type DiffRefs = { base_sha: string; head_sha: string; start_sha: string };
type InlineCommentResult =
  | { posted: false; error: string }
  | { posted: true; noteId: string | number | undefined }
  | { posted: true; discussionId: string | number };

export type PublishToolKey = 'post_review_comment' | 'post_inline_comment' | 'send_dingtalk_notification';
const ALL_PUBLISH_TOOLS = new Set<PublishToolKey>([
  'post_review_comment',
  'post_inline_comment',
  'send_dingtalk_notification',
]);

/** 发布上下文不依赖本地工作区，追问即使无法读取代码也能按用户要求发送。 */
export type PublishContext = {
  gitlab: GitLabService;
  projectId: number;
  mrIid: number | null;
  commitSha: string | null;
  diffRefs: DiffRefs | null;
  loadDiffRefs?: () => Promise<DiffRefs | null>;
  enableMrComment: boolean;
  dingtalkRepository: DingtalkRepositoryConfig;
  enabledTools?: Set<ToolKey>;
};

/** 审查上下文 = 工作区 + MR 信息与输出配置。 */
export type ReviewContext = WorkspaceContext & PublishContext & {
  runtimeMemory?: ReviewRuntimeMemory;
};

function toolEnabled(ctx: { enabledTools?: Set<ToolKey> }, key: ToolKey): boolean {
  return ctx.enabledTools?.has(key) ?? true;
}

/**
 * 从会话构造发布上下文。行级评论需要的 MR diff_refs 在实际调用工具时按需加载。
 */
export function buildPublishContext(session: SessionWithRepository): PublishContext {
  const repo = session.repository;
  if (!repo) throw new Error('会话未绑定仓库，无法构造发布上下文');
  const gitlab = createGitLabService(repo.gitLabAccount.url, repo.gitLabAccount.accessToken);
  return {
    gitlab,
    projectId: repo.gitLabProjectId,
    mrIid: session.mrIid,
    commitSha: session.commitSha,
    diffRefs: null,
    loadDiffRefs: session.mrIid == null
      ? undefined
      : () => gitlab.getMergeRequest(repo.gitLabProjectId, session.mrIid!).then((mr) => mr.diff_refs ?? null),
    enableMrComment: repo.enableMrComment,
    dingtalkRepository: {
      enableDingtalk: repo.enableDingtalk,
      dingtalkWebhook: repo.dingtalkWebhook,
      dingtalkSecret: repo.dingtalkSecret,
    },
  };
}

export function buildReviewContext(
  session: SessionWithRepository,
  workspace: Workspace,
): ReviewContext {
  return {
    ...buildPublishContext(session),
    repoId: session.repository!.id,
    workdir: workspace.dir,
    diffRef: workspace.diffRef,
  };
}

/** 把外部路径限制在工作区内，防 ../ 逃逸。返回绝对路径或 null。 */
function safeResolve(workdir: string, p: string): string | null {
  const abs = path.resolve(workdir, p);
  const rel = path.relative(workdir, abs);
  return rel.startsWith('..') || path.isAbsolute(rel) ? null : abs;
}

export function readWorkspaceLine(
  workdir: string,
  filePath: string,
  line: number,
): Promise<{ path: string; line: number; text: string }> {
  if (!Number.isInteger(line) || line < 1) return Promise.reject(new Error(`无效行号：${line}`));
  const abs = safeResolve(workdir, filePath);
  if (!abs) return Promise.reject(new Error(`路径越界：${filePath}`));
  return Promise.all([realpath(workdir), realpath(abs)])
    .then(([realWorkdir, realFile]) => {
      const rel = path.relative(realWorkdir, realFile);
      if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`路径越界：${filePath}`);
      return readFile(realFile, 'utf8');
    })
    .then((content) => {
      const lines = content.split(/\r?\n/);
      if (line > lines.length) throw new Error(`行号越界：${filePath}:${line}（文件共 ${lines.length} 行）`);
      return { path: path.relative(workdir, abs), line, text: lines[line - 1] ?? '' };
    });
}

/** 只读探索工具集（在工作区里跑）——审查主 agent、subagent 与对话 agent 共用。 */
export function buildReadTools(ctx: WorkspaceContext) {
  return {
    ...(toolEnabled(ctx, 'bash')
      ? {
          bash: tool({
            description:
              '在仓库工作区里执行只读 shell 命令自由探索代码（grep/rg/find/cat/sed/git log 等，支持管道）。' +
              '仅限只读：不得写文件（含重定向、find -exec/-delete、sed -i）、联网、命令替换或变量展开。工作目录即仓库根，路径用相对路径。',
            inputSchema: z.object({ command: z.string().describe('要执行的只读命令，如 `rg -n "TODO" src`') }),
            execute: async ({ command }) => {
              if (!isReadOnlyCommand(command)) {
                return `已拒绝：仅允许只读命令（grep/rg/find/cat/sed/git log 等），不得写文件、联网、命令替换或变量展开（$VAR）。`;
              }
              return exec(command, { cwd: ctx.workdir, shell: '/bin/sh', timeout: CMD_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 })
                .then((r) => truncate(r.stdout || r.stderr || '(无输出)'))
                .catch((e: { stdout?: string; stderr?: string; message?: string }) =>
                  truncate(e.stdout || e.stderr || e.message || '命令执行失败'),
                );
            },
          }),
        }
      : {}),

    ...(toolEnabled(ctx, 'read_file')
      ? {
          read_file: tool({
            description: '读取工作区内某个文件的完整内容（理解跨行/跨文件上下文）。',
            inputSchema: z.object({ path: z.string().describe('相对仓库根的文件路径，如 src/app.ts') }),
            execute: async ({ path: p }) => {
              const abs = safeResolve(ctx.workdir, p);
              if (!abs) return `路径越界：${p}`;
              return readFile(abs, 'utf8').then(truncate, () => `读取失败：${p}（不存在或非文本）`);
            },
          }),
        }
      : {}),

    ...(toolEnabled(ctx, 'read_memory')
      ? {
          read_memory: tool({
            description: '读取本仓库的项目记忆（跨次审查沉淀的约定/架构/历史问题）。',
            inputSchema: z.object({}),
            execute: () => readRepositoryMemory(ctx.repoId),
          }),
        }
      : {}),

    // 纯对话会话没有 diff 基准，不提供 git_diff（bash 里的 git diff/log/show 足够探索）
    ...(ctx.diffRef && toolEnabled(ctx, 'git_diff')
      ? {
          git_diff: tool({
            description:
              '查看本次审查的代码变更（MR 为目标分支到当前 HEAD；Push 为 before 到 after）。可传 paths 只看指定文件。',
            inputSchema: z.object({ paths: z.array(z.string()).optional().describe('只看这些文件路径') }),
            execute: async ({ paths }) => {
              const args = ['-C', ctx.workdir, 'diff', `${ctx.diffRef}...HEAD`];
              if (paths?.length) args.push('--', ...paths);
              return exec('git', args, { timeout: CMD_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 })
                .then((r) => truncate(r.stdout || '（无变更）'))
                .catch((e: { stderr?: string; message?: string }) => `git diff 失败：${e.stderr || e.message}`);
            },
          }),
        }
      : {}),
  };
}

/**
 * Agent 工具集 = 只读探索 + 可选记忆沉淀 + 发布工具。
 * Webhook 主审查关闭 publish，由系统在 verify 增强成功后确定性发布；追问对话按仓库配置暴露发布工具。
 */
export function buildTools(ctx: ReviewContext, opts: { publish?: boolean; memoryWrite?: boolean } = {}) {
  const publish = opts.publish ?? false;
  const memoryWrite = opts.memoryWrite ?? true;
  return {
    ...buildReadTools(ctx),
    ...(publish ? buildPublishTools(ctx, ALL_PUBLISH_TOOLS) : {}),

    ...(memoryWrite && toolEnabled(ctx, 'write_memory')
      ? {
          write_memory: tool({
            description: '更新本仓库的项目记忆（整体覆盖）。把本次审查得到的、对后续有用的项目认知沉淀进去。',
            inputSchema: z.object({ content: z.string().describe('完整的 Markdown 记忆内容') }),
            execute: ({ content }) => writeRepositoryMemory(ctx.repoId, content),
          }),
        }
      : {}),

    ...(ctx.runtimeMemory && toolEnabled(ctx, 'record_evidence')
      ? {
          record_evidence: tool({
            description:
              '记录本轮审查已经亲自核验过的 CodeMem 证据。只记录能被代码、diff、调用方或项目记忆支撑的材料，供可选的 verify 增强复核。',
            inputSchema: z.object({
              fileSummary: z.string().optional().describe('关键文件或模块摘要'),
              evidence: z.string().optional().describe('已确认的问题证据，需包含文件/行号或取证来源'),
              dependencyNote: z.string().optional().describe('调用关系、依赖关系或配置影响'),
            }),
            execute: ({ fileSummary, evidence, dependencyNote }) => {
              if (!ctx.runtimeMemory) return '运行期 CodeMem 未启用。';
              recordRuntimeEvidence(ctx.runtimeMemory, { fileSummary, evidence, dependencyNote });
              return '已记录到本轮运行期 CodeMem。';
            },
          }),
        }
      : {}),
  };
}

/** 发布工具：服务端本轮授权、渠道配置和仓库 Tool 开关共同决定是否挂载。 */
export function buildPublishTools(ctx: PublishContext, authorizedTools: ReadonlySet<PublishToolKey>) {
  return {
    ...(authorizedTools.has('post_review_comment') && ctx.enableMrComment && toolEnabled(ctx, 'post_review_comment')
      ? {
          post_review_comment: tool({
            description: '仅当最新用户消息明确要求发布 GitLab 评论时调用，把完整 Markdown 内容发布到当前 MR 或 Push commit。',
            inputSchema: z.object({ markdown: z.string().describe('完整的 Markdown 审查总评，按严重级别分组') }),
            execute: async ({ markdown }) => {
              if (ctx.mrIid == null) {
                if (!ctx.commitSha) return '当前会话未绑定 commit，无法发布评论。';
                const res = await ctx.gitlab.createCommitComment(ctx.projectId, ctx.commitSha, markdown);
                return { posted: true, noteId: res.id ?? res.note_id };
              }
              const res = await ctx.gitlab.createMergeRequestComment(ctx.projectId, ctx.mrIid, markdown);
              return { posted: true, discussionId: res.id };
            },
          }),
        }
      : {}),

    ...(authorizedTools.has('post_inline_comment') && ctx.enableMrComment && toolEnabled(ctx, 'post_inline_comment')
      ? {
          post_inline_comment: tool({
            description: '仅当最新用户消息明确要求发布 GitLab 行级评论时调用，在当前 MR 或 Push commit 的具体文件行发表评论。',
            inputSchema: z.object({
              path: z.string().describe('文件路径（new_path）'),
              line: z.number().describe('新文件中的行号'),
              body: z.string().describe('该行的评论内容（Markdown）'),
            }),
            execute: ({ path: p, line, body }): Promise<InlineCommentResult> => {
              if (ctx.mrIid == null) {
                if (!ctx.commitSha) return Promise.resolve({ posted: false, error: '当前会话未绑定 commit，无法发布行级评论。' });
                return ctx.gitlab.createCommitComment(ctx.projectId, ctx.commitSha, body, { path: p, line, line_type: 'new' })
                  .then((res) => ({ posted: true, noteId: res.id ?? res.note_id }));
              }
              const diffRefs: Promise<DiffRefs | null> = ctx.diffRefs
                ? Promise.resolve(ctx.diffRefs)
                : ctx.loadDiffRefs?.() ?? Promise.resolve(null);
              return diffRefs.then<InlineCommentResult>((refs) => {
                if (!refs) return { posted: false, error: '缺少 MR diff_refs，无法定位行级评论。' };
                return ctx.gitlab.createMergeRequestComment(ctx.projectId, ctx.mrIid!, body, {
                  ...refs,
                  old_path: p,
                  new_path: p,
                  new_line: line,
                  position_type: 'text',
                }).then((res) => ({ posted: true, discussionId: res.id }));
              });
            },
          }),
        }
      : {}),

    ...(authorizedTools.has('send_dingtalk_notification') && ctx.dingtalkRepository.enableDingtalk && toolEnabled(ctx, 'send_dingtalk_notification')
      ? {
          send_dingtalk_notification: tool({
            description: '仅当最新用户消息明确要求发送钉钉时调用，把指定 Markdown 内容发送到仓库配置的钉钉机器人。',
            inputSchema: z.object({
              title: z.string().trim().min(1).max(200).describe('钉钉通知标题'),
              markdown: z.string().trim().min(1).max(30_000).describe('钉钉通知 Markdown 正文'),
            }),
            execute: ({ title, markdown }) =>
              sendRepositoryDingtalkNotification(ctx.dingtalkRepository, title, markdown).then((result) => ({
                sent: result === 'sent',
                result,
              })),
          }),
        }
      : {}),
  };
}

export type ReviewTools = ReturnType<typeof buildTools>;
