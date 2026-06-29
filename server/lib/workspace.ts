import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readdir, rm, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import type { SessionWithRepository } from './chat-store';
import { createLogger } from './logger';

const log = createLogger('workspace');
const exec = promisify(execFile);

const WORKSPACE_ROOT = path.resolve(process.env.WORKSPACE_ROOT ?? './.workspaces');
const TTL_MS = Number(process.env.WORKSPACE_TTL_HOURS ?? 72) * 3600_000;

/**
 * 同仓库的主仓操作（clone/fetch/worktree add）必须串行：它们都写 repo/.git 元数据，
 * 并发会触发 git index.lock 冲突。用 per-repoId 的 Promise 链做 mutex。
 */
const repoLocks = new Map<string, Promise<unknown>>();
function withRepoLock<T>(repoId: string, fn: () => Promise<T>): Promise<T> {
  const prev = repoLocks.get(repoId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  repoLocks.set(repoId, next.catch(() => undefined));
  return next;
}

/** 把 GitLab 实例地址 + 仓库 path 拼成干净的 clone 地址（不含 token）。 */
function cloneUrl(accountUrl: string, repoPath: string): string {
  return `${new URL(accountUrl).origin}/${repoPath}.git`;
}

/**
 * token 不落盘：clone 地址保持干净，认证用 http.extraHeader 通过 -c 临时注入。
 * GitLab 走 git over https 的标准方式是 Basic base64("oauth2:<token>")。
 */
function authArgs(token: string): string[] {
  const basic = Buffer.from(`oauth2:${token}`).toString('base64');
  return ['-c', `http.extraHeader=Authorization: Basic ${basic}`];
}

/** worktree 目录名：commitSha 是 40 位 hex，安全；缺失时退回 sanitized 分支名。 */
function worktreeKey(session: SessionWithRepository): string {
  const sha = session.commitSha?.trim();
  if (sha) return sha;
  const branch = session.sourceBranch?.trim();
  if (!branch) throw new Error('会话缺少 commitSha 与 sourceBranch，无法定位工作区');
  return `branch-${branch.replace(/[^\w.-]/g, '_')}`;
}

/** 审查工作区准备结果。 */
export type Workspace = {
  /** worktree 绝对路径（agent 所有工具的 cwd） */
  dir: string;
  /** git diff 的基准远程分支引用，如 origin/main */
  targetRef: string;
};

/**
 * 准备一次审查/追问的工作区：clone（首次）→ fetch → worktree add（按 commit）。
 * 命中已存在的 worktree 直接复用（追问保活）。同仓库串行、不同 MR 各自独立 worktree。
 */
export function prepareWorkspace(session: SessionWithRepository): Promise<Workspace> {
  const repo = session.repository;
  if (!repo) throw new Error('会话未绑定仓库，无法准备工作区');

  const repoId = repo.id;
  const baseDir = path.join(WORKSPACE_ROOT, repoId);
  const gitDir = path.join(baseDir, 'repo');
  const wtDir = path.join(baseDir, 'wt', worktreeKey(session));
  const auth = authArgs(repo.gitLabAccount.accessToken);
  const url = cloneUrl(repo.gitLabAccount.url, repo.path);
  const sourceBranch = session.sourceBranch ?? '';
  const targetBranch = session.targetBranch ?? '';
  const checkoutRef = session.commitSha?.trim() || `origin/${sourceBranch}`;

  return withRepoLock(repoId, async () => {
    await cleanupExpired(baseDir).catch((err) => log.warn('清理过期工作区失败', err));

    // 1. 首次 clone（保留 .git，作为 worktree 主仓）
    if (!(await exists(gitDir))) {
      await mkdir(baseDir, { recursive: true });
      log.info(`clone 仓库 ${repo.path} → ${gitDir}`);
      await git([...auth, 'clone', '--no-tags', url, gitDir]);
    }

    // 2. fetch 最新 source/target（target 供 diff 基准）
    const branches = [sourceBranch, targetBranch].filter(Boolean);
    await git(['-C', gitDir, ...auth, 'fetch', 'origin', ...branches, '--prune']);

    // 3. worktree：命中复用并 touch；否则按 commit 创建
    if (await exists(wtDir)) {
      const now = new Date();
      await utimes(wtDir, now, now).catch(() => undefined);
    } else {
      await mkdir(path.dirname(wtDir), { recursive: true }); // git worktree add 要求父目录存在
      log.info(`worktree add ${wtDir} @ ${checkoutRef}`);
      await git(['-C', gitDir, 'worktree', 'add', '--detach', wtDir, checkoutRef]);
    }

    return { dir: wtDir, targetRef: `origin/${targetBranch}` };
  });
}

/** 执行 git 命令（数组传参，无 shell 注入）。失败抛出，交由调用方快速失败。 */
async function git(args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

async function exists(p: string): Promise<boolean> {
  return stat(p).then(
    () => true,
    () => false,
  );
}

/** 清理某仓库下 mtime 超过 TTL 的 worktree（best-effort，需在 repo 锁内调用）。 */
async function cleanupExpired(baseDir: string): Promise<void> {
  const wtRoot = path.join(baseDir, 'wt');
  const gitDir = path.join(baseDir, 'repo');
  const entries = await readdir(wtRoot, { withFileTypes: true }).catch(() => []);
  const now = Date.now();
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const wt = path.join(wtRoot, e.name);
    const info = await stat(wt).catch(() => null);
    if (!info || now - info.mtimeMs < TTL_MS) continue;
    log.info(`清理过期 worktree ${wt}`);
    await git(['-C', gitDir, 'worktree', 'remove', '--force', wt]).catch(() => undefined);
    await rm(wt, { recursive: true, force: true }).catch(() => undefined);
  }
}
