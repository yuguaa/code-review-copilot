import { tool } from 'ai';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createGitLabService, type GitLabService } from '../lib/gitlab';
import { sendDingtalk } from '../lib/dingtalk';
import { prisma } from '../lib/prisma';
import type { SessionWithRepository } from '../lib/chat-store';
import type { Workspace } from '../lib/workspace';

const exec = promisify(execFile);
const MAX_CHARS = 30_000; // 单次工具返回上限，避免撑爆上下文
const CMD_TIMEOUT_MS = 30_000;

function truncate(text: string): string {
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n…(已截断，共 ${text.length} 字符)` : text;
}

/** 审查上下文：一次审查/会话锁定的工作区、MR 信息与输出配置。 */
export type ReviewContext = {
  gitlab: GitLabService;
  projectId: number;
  mrIid: number | null;
  repoId: string;
  workdir: string; // worktree 绝对路径，所有只读工具的 cwd
  targetRef: string; // git diff 基准，如 origin/main
  diffRefs: { base_sha: string; head_sha: string; start_sha: string } | null;
  enableMrComment: boolean;
  enableDingtalk: boolean;
  dingtalk: { webhook: string; secret: string | null } | null;
};

/**
 * 从会话 + 已就绪的工作区构造审查上下文。
 * 异步：行级评论需要 MR 的 diff_refs（base/start/head sha），在此拉一次。
 */
export async function buildReviewContext(
  session: SessionWithRepository,
  workspace: Workspace,
): Promise<ReviewContext> {
  const repo = session.repository;
  if (!repo) throw new Error('会话未绑定仓库，无法构造审查上下文');
  const gitlab = createGitLabService(repo.gitLabAccount.url, repo.gitLabAccount.accessToken);
  const mr = session.mrIid != null ? await gitlab.getMergeRequest(repo.gitLabProjectId, session.mrIid) : null;
  const notification = await prisma.notificationSetting.findUnique({ where: { scope: 'global' } });
  const dingtalk = repo.dingtalkWebhook
    ? { webhook: repo.dingtalkWebhook, secret: repo.dingtalkSecret }
    : notification?.dingtalkEnabled && notification.dingtalkWebhookUrl
      ? { webhook: notification.dingtalkWebhookUrl, secret: notification.dingtalkSecret }
      : null;
  return {
    gitlab,
    projectId: repo.gitLabProjectId,
    mrIid: session.mrIid,
    repoId: repo.id,
    workdir: workspace.dir,
    targetRef: workspace.targetRef,
    diffRefs: mr?.diff_refs ?? null,
    enableMrComment: repo.enableMrComment,
    enableDingtalk: repo.enableDingtalk,
    dingtalk,
  };
}

// —— bash 只读门禁 ——

/** 只读命令白名单（首词）。git 另按子命令二次校验。 */
const READONLY_CMDS = new Set([
  'grep', 'rg', 'find', 'cat', 'head', 'tail', 'ls', 'wc', 'tree', 'sed', 'awk',
  'sort', 'uniq', 'diff', 'pwd', 'echo', 'basename', 'dirname', 'realpath',
  'stat', 'file', 'cut', 'nl', 'comm', 'xargs', 'true', 'test',
]);
const READONLY_GIT_SUB = new Set([
  'log', 'diff', 'show', 'status', 'blame', 'ls-files', 'ls-tree', 'cat-file',
  'rev-parse', 'grep', 'shortlog', 'describe', 'branch', 'tag', 'remote', 'config',
]);

/**
 * 判断一条命令是否纯只读：拆分管道/逻辑串，逐段校验首词在白名单内，
 * 并禁止输出重定向与命令替换。导出供单测。
 */
export function isReadOnlyCommand(command: string): boolean {
  const cmd = command.trim();
  if (!cmd) return false;
  // 禁止写重定向（允许 2>&1 / 2>/dev/null 这类 stderr 合流）与命令替换
  if (/(^|[^2\d])>>?/.test(cmd)) return false;
  if (/[`]|\$\(/.test(cmd)) return false;
  const segments = cmd.split(/\||&&|\|\||;/);
  for (const seg of segments) {
    const tokens = seg.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const head = tokens[0];
    if (head === 'git') {
      const sub = tokens.slice(1).find((t) => !t.startsWith('-'));
      if (!sub || !READONLY_GIT_SUB.has(sub)) return false;
    } else if (!READONLY_CMDS.has(head)) {
      return false;
    }
  }
  return true;
}

/** 把外部路径限制在工作区内，防 ../ 逃逸。返回绝对路径或 null。 */
function safeResolve(workdir: string, p: string): string | null {
  const abs = path.resolve(workdir, p);
  const rel = path.relative(workdir, abs);
  return rel.startsWith('..') || path.isAbsolute(rel) ? null : abs;
}

/** 只读探索工具集（在工作区里跑）——主 agent 与各 subagent 共用。 */
export function buildReadTools(ctx: ReviewContext) {
  return {
    bash: tool({
      description:
        '在仓库工作区里执行只读 shell 命令自由探索代码（grep/rg/find/cat/sed/awk/git log 等，支持管道）。' +
        '禁止任何写操作、网络与命令替换。工作目录即仓库根，路径用相对路径。',
      inputSchema: z.object({ command: z.string().describe('要执行的只读命令，如 `rg -n "TODO" src`') }),
      execute: async ({ command }) => {
        if (!isReadOnlyCommand(command)) {
          return `已拒绝：仅允许只读命令（grep/rg/find/cat/git log 等），不得写文件、联网或命令替换。`;
        }
        return exec(command, { cwd: ctx.workdir, shell: '/bin/sh', timeout: CMD_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 })
          .then((r) => truncate(r.stdout || r.stderr || '(无输出)'))
          .catch((e: { stdout?: string; stderr?: string; message?: string }) =>
            truncate(e.stdout || e.stderr || e.message || '命令执行失败'),
          );
      },
    }),

    read_file: tool({
      description: '读取工作区内某个文件的完整内容（理解跨行/跨文件上下文）。',
      inputSchema: z.object({ path: z.string().describe('相对仓库根的文件路径，如 src/app.ts') }),
      execute: async ({ path: p }) => {
        const abs = safeResolve(ctx.workdir, p);
        if (!abs) return `路径越界：${p}`;
        return readFile(abs, 'utf8').then(truncate, () => `读取失败：${p}（不存在或非文本）`);
      },
    }),

    git_diff: tool({
      description: '查看本次 MR 相对目标分支的代码变更（git diff）。可传 paths 只看指定文件。',
      inputSchema: z.object({ paths: z.array(z.string()).optional().describe('只看这些文件路径') }),
      execute: async ({ paths }) => {
        const args = ['-C', ctx.workdir, 'diff', `${ctx.targetRef}...HEAD`];
        if (paths?.length) args.push('--', ...paths);
        return exec('git', args, { timeout: CMD_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 })
          .then((r) => truncate(r.stdout || '（无变更）'))
          .catch((e: { stderr?: string; message?: string }) => `git diff 失败：${e.stderr || e.message}`);
      },
    }),
  };
}

/** 主 agent 工具集 = 只读探索 + 项目记忆 + 输出渠道（受开关控制）。 */
export function buildTools(ctx: ReviewContext) {
  return {
    ...buildReadTools(ctx),

    read_memory: tool({
      description: '读取本仓库的项目记忆（跨次审查沉淀的约定/架构/历史问题）。审查开始时先读它。',
      inputSchema: z.object({}),
      execute: async () => {
        const repo = await prisma.repository.findUnique({ where: { id: ctx.repoId }, select: { memory: true } });
        return repo?.memory?.trim() || '（暂无项目记忆）';
      },
    }),

    write_memory: tool({
      description: '更新本仓库的项目记忆（整体覆盖）。把本次审查得到的、对后续有用的项目认知沉淀进去。',
      inputSchema: z.object({ content: z.string().describe('完整的 Markdown 记忆内容') }),
      execute: async ({ content }) => {
        await prisma.repository.update({ where: { id: ctx.repoId }, data: { memory: content } });
        return { saved: true };
      },
    }),

    post_review_comment: tool({
      description: '把审查总评作为一条 Markdown 评论发布到 MR。完成审查、整理好所有问题后调用一次。',
      inputSchema: z.object({ markdown: z.string().describe('完整的 Markdown 审查总评，按严重级别分组') }),
      execute: async ({ markdown }) => {
        if (!ctx.enableMrComment) return '该仓库未开启 MR 评论，已跳过发布。';
        if (ctx.mrIid == null) return '当前会话未绑定 MR，无法发布评论。';
        const res = await ctx.gitlab.createMergeRequestComment(ctx.projectId, ctx.mrIid, markdown);
        return { posted: true, discussionId: res.id };
      },
    }),

    post_inline_comment: tool({
      description: '在 MR 某文件的具体行上发表行级评论（精准定位问题）。',
      inputSchema: z.object({
        path: z.string().describe('文件路径（new_path）'),
        line: z.number().describe('新文件中的行号'),
        body: z.string().describe('该行的评论内容（Markdown）'),
      }),
      execute: async ({ path: p, line, body }) => {
        if (!ctx.enableMrComment) return '该仓库未开启 MR 评论，已跳过。';
        if (ctx.mrIid == null) return '当前会话未绑定 MR，无法发布行级评论。';
        if (!ctx.diffRefs) return '缺少 MR diff_refs，无法定位行级评论。';
        const res = await ctx.gitlab.createMergeRequestComment(ctx.projectId, ctx.mrIid, body, {
          ...ctx.diffRefs,
          old_path: p,
          new_path: p,
          new_line: line,
          position_type: 'text',
        });
        return { posted: true, discussionId: res.id };
      },
    }),

    notify_dingtalk: tool({
      description: '把审查结论推送到钉钉群（markdown）。',
      inputSchema: z.object({
        title: z.string().describe('钉钉消息标题（会话列表预览用）'),
        text: z.string().describe('markdown 正文'),
      }),
      execute: async ({ title, text }) => {
        if (!ctx.enableDingtalk || !ctx.dingtalk) return '该仓库未开启钉钉推送，已跳过。';
        await sendDingtalk(ctx.dingtalk, title, text);
        return { sent: true };
      },
    }),
  };
}

export type ReviewTools = ReturnType<typeof buildTools>;
