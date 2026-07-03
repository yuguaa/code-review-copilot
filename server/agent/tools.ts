import { tool } from 'ai';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createGitLabService, type GitLabService } from '../lib/gitlab';
import type { SessionWithRepository } from '../lib/chat-store';
import type { Workspace } from '../lib/workspace';
import type { ToolKey } from '../modules/capabilities/capabilities.service';
import {
  readRepositoryMemory,
  writeRepositoryMemory,
} from '../modules/repositories/repositories.service';

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

/** 审查上下文 = 工作区 + MR 信息与输出配置。 */
export type ReviewContext = WorkspaceContext & {
  gitlab: GitLabService;
  projectId: number;
  mrIid: number | null;
  commitSha: string | null;
  diffRefs: { base_sha: string; head_sha: string; start_sha: string } | null;
  enableMrComment: boolean;
};

function toolEnabled(ctx: WorkspaceContext, key: ToolKey): boolean {
  return ctx.enabledTools?.has(key) ?? true;
}

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
  return {
    gitlab,
    projectId: repo.gitLabProjectId,
    mrIid: session.mrIid,
    repoId: repo.id,
    workdir: workspace.dir,
    diffRef: workspace.diffRef,
    commitSha: session.commitSha,
    diffRefs: mr?.diff_refs ?? null,
    enableMrComment: repo.enableMrComment,
  };
}

// —— bash 只读门禁 ——

/**
 * 只读命令白名单（首词）。git 另按子命令二次校验。
 * 刻意不含 awk / xargs：前者是可 system() 的通用解释器，后者会把参数当命令执行，
 * 二者无法靠参数级校验安全收敛。列出的命令再按 hasDangerousArgs 剔除其写文件/执行子参数。
 */
const READONLY_CMDS = new Set([
  'grep', 'rg', 'find', 'cat', 'head', 'tail', 'ls', 'wc', 'tree', 'sed',
  'sort', 'uniq', 'diff', 'pwd', 'echo', 'basename', 'dirname', 'realpath',
  'stat', 'file', 'cut', 'nl', 'comm', 'true', 'test',
]);
const READONLY_GIT_SUB = new Set([
  'log', 'diff', 'show', 'status', 'blame', 'ls-files', 'ls-tree', 'cat-file',
  'rev-parse', 'grep', 'shortlog', 'describe', 'branch', 'tag', 'remote', 'config',
]);

/** find 会执行命令或写文件的动作参数。 */
const FIND_WRITE_ACTIONS = new Set(['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprintf', '-fls', '-fprint0']);

/** 白名单命令里仍会写文件/执行命令的危险参数：命中即拒。 */
function hasDangerousArgs(head: string, args: string[]): boolean {
  if (head === 'find') return args.some((a) => FIND_WRITE_ACTIONS.has(a));
  // sed -i / -i.bak / --in-place 原地改写文件（-i 是 sed 唯一含 i 的短选项）
  if (head === 'sed') return args.some((a) => /^-[a-z]*i/.test(a) || a.startsWith('--in-place'));
  // sort -o / --output 写文件
  if (head === 'sort') return args.some((a) => a === '-o' || a.startsWith('-o') || a.startsWith('--output'));
  return false;
}

/**
 * 判断一条命令是否纯只读。导出供单测。
 * 规则：拆分所有 shell 串联符（| & ; 换行）逐段校验首词在白名单内且无危险参数；
 * 禁止写重定向、命令替换与变量展开（变量展开会外泄进程环境里的密钥）。
 */
export function isReadOnlyCommand(command: string): boolean {
  const cmd = command.trim();
  if (!cmd) return false;
  // 写重定向：任何 > / >> 只放行 fd 复制形式（>&1、2>&1），其余（>file、1>file、2>/dev/null）一律拒
  if (/>>?(?!&)/.test(cmd)) return false;
  // 命令替换（反引号、$()）与变量展开（$VAR、${VAR}）——$ 作为正则行尾锚点（后跟引号/空白/结尾）仍放行
  if (/[`]/.test(cmd) || /\$[({A-Za-z_]/.test(cmd)) return false;
  // 换行与单 & 也是命令分隔符，必须一并拆分，否则多条命令被压平后只校验首词；
  // 但 >& 里的 & 是 fd 复制（如 2>&1），用负向后顾排除，不当分隔符
  const segments = cmd.split(/\||;|\n|\r|(?<!>)&/);
  for (const seg of segments) {
    const tokens = seg.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const head = tokens[0];
    const args = tokens.slice(1);
    if (head === 'git') {
      const sub = args.find((t) => !t.startsWith('-'));
      if (!sub || !READONLY_GIT_SUB.has(sub)) return false;
    } else if (!READONLY_CMDS.has(head)) {
      return false;
    }
    if (hasDangerousArgs(head, args)) return false;
  }
  return true;
}

/** 把外部路径限制在工作区内，防 ../ 逃逸。返回绝对路径或 null。 */
function safeResolve(workdir: string, p: string): string | null {
  const abs = path.resolve(workdir, p);
  const rel = path.relative(workdir, abs);
  return rel.startsWith('..') || path.isAbsolute(rel) ? null : abs;
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
 * 审查主 agent 工具集 = 只读探索 + 记忆沉淀 + 平台评论（enableMrComment 关闭时干脆不提供发布工具）。
 * 钉钉推送不是工具：审查完成后由系统按 enableDingtalk 确定性发送。
 */
export function buildTools(ctx: ReviewContext) {
  return {
    ...buildReadTools(ctx),
    ...(ctx.enableMrComment ? buildPublishTools(ctx) : {}),

    ...(toolEnabled(ctx, 'write_memory')
      ? {
          write_memory: tool({
            description: '更新本仓库的项目记忆（整体覆盖）。把本次审查得到的、对后续有用的项目认知沉淀进去。',
            inputSchema: z.object({ content: z.string().describe('完整的 Markdown 记忆内容') }),
            execute: ({ content }) => writeRepositoryMemory(ctx.repoId, content),
          }),
        }
      : {}),
  };
}

/** 平台评论发布工具：仅在仓库开启 enableMrComment 时挂载。 */
function buildPublishTools(ctx: ReviewContext) {
  return {
    ...(toolEnabled(ctx, 'post_review_comment')
      ? {
          post_review_comment: tool({
            description: '把审查总评作为一条 Markdown 评论发布到 MR 或 Push commit。完成审查、整理好所有问题后调用一次。',
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

    ...(toolEnabled(ctx, 'post_inline_comment')
      ? {
          post_inline_comment: tool({
            description: '在 MR 某文件的具体行上发表行级评论（精准定位问题）。',
            inputSchema: z.object({
              path: z.string().describe('文件路径（new_path）'),
              line: z.number().describe('新文件中的行号'),
              body: z.string().describe('该行的评论内容（Markdown）'),
            }),
            execute: async ({ path: p, line, body }) => {
              if (ctx.mrIid == null) {
                if (!ctx.commitSha) return '当前会话未绑定 commit，无法发布行级评论。';
                const res = await ctx.gitlab.createCommitComment(ctx.projectId, ctx.commitSha, body, { path: p, line, line_type: 'new' });
                return { posted: true, noteId: res.id ?? res.note_id };
              }
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
        }
      : {}),
  };
}

export type ReviewTools = ReturnType<typeof buildTools>;
