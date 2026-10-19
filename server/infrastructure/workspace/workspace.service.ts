import { mkdir, readdir, rename, rm, stat, utimes } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { workspaceConfig } from "@server/config/workspace.config";
import { prisma } from "@server/infrastructure/prisma/prisma.service";
import { executeChecked } from "@server/infrastructure/process/process.service";
import { createGitLabService } from "@server/shared/gitlab/gitlab.service";

import type { SessionWithRepository } from "@server/modules/sessions/session-message-store.service";

const locks = new Map<string, Promise<unknown>>();
const commitPattern = /^[a-f0-9]{40}$/i;

export function assertCommit(sha: string): string {
  if (!commitPattern.test(sha)) throw new Error("无效的 Commit SHA");
  return sha;
}

export function prepareRunWorkspace(session: SessionWithRepository, run: { id: string; baseSha: string | null; headSha: string | null }, signal?: AbortSignal): Promise<Workspace> {
  const repo = session.repository;
  if (!repo || !run.headSha || !run.baseSha) return Promise.reject(new Error("运行缺少仓库或提交范围"));
  const head = assertCommit(run.headSha);
  const base = assertCommit(run.baseSha);
  const repositoryRoot = path.join(workspaceConfig.root, repo.id);
  const gitDir = path.join(repositoryRoot, "repo.git");
  const dir = path.join(repositoryRoot, "runs", run.id);
  const gitUrl = new URL(repo.gitLabAccount.url);
  gitUrl.pathname = `${gitUrl.pathname.replace(/\/$/, "")}/${repo.path}.git`;
  if (!["http:", "https:"].includes(gitUrl.protocol) || gitUrl.username || gitUrl.password) throw new Error("GitLab 地址无效");
  /* Git 认证通过进程环境传递，仓库地址和命令参数只包含公开信息。 */
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`oauth2:${repo.gitLabAccount.accessToken}`).toString("base64")}`,
  };
  const git = (args: string[]) => executeChecked("git", args, { env, signal, timeoutMs: 120_000 });
  const previous = locks.get(repo.id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => mkdir(repositoryRoot, { recursive: true }))
    .then(() => stat(gitDir).then(() => true, (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return false;
    }))
    .then((exists) => {
      if (exists) return;
      const staging = path.join(repositoryRoot, `clone-${randomUUID()}`);
      return git(["clone", "--bare", "--no-tags", "--", gitUrl.toString(), staging]).then(() => rename(staging, gitDir))
        .catch((error: unknown) => rm(staging, { recursive: true, force: true }).then(() => { throw error; }));
    })
    .then(() => git(["--git-dir", gitDir, "fetch", "--no-tags", "origin", head, base]))
    .then(() => git(["--git-dir", gitDir, "merge-base", base, head]))
    .then((mergeBase) => {
      if (mergeBase !== base) throw new Error("提交范围存在非祖先关系，OCR 无法按本次 Push 的直接差异审查");
      return mkdir(path.dirname(dir), { recursive: true });
    })
    .then(() => stat(dir).then(() => true, (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return false;
    }))
    .then((exists) => exists ? git(["-C", dir, "rev-parse", "HEAD"]).then((actual) => {
      if (actual !== head) throw new Error("工作区提交与运行记录不一致");
    }) : git(["--git-dir", gitDir, "worktree", "add", "--detach", dir, head]).then(() => undefined))
    .then(() => utimes(dir, new Date(), new Date()))
    .then(() => git(["-C", dir, "diff", "--quiet", "HEAD", "--"]))
    .then(() => ({ dir, diffRef: base }));
  locks.set(repo.id, next);
  void next.finally(() => { if (locks.get(repo.id) === next) locks.delete(repo.id); }).catch(() => undefined);
  return next;
}

export function prepareChatWorkspace(session: SessionWithRepository, run?: { id: string; baseSha: string | null; headSha: string | null } | null, signal?: AbortSignal): Promise<Workspace> {
  if (run) return prepareRunWorkspace(session, run, signal);
  const repo = session.repository;
  if (!repo || !repo.isActive) return Promise.reject(new Error("会话仓库不存在或已停用"));
  const gitlab = createGitLabService(repo.gitLabAccount.url, repo.gitLabAccount.accessToken);
  const resolveCommit = session.commitSha ? Promise.resolve(session.commitSha) : gitlab.getProject(repo.gitLabProjectId)
    .then((project) => {
      if (!project.default_branch) throw new Error("仓库没有默认分支");
      return gitlab.getBranch(repo.gitLabProjectId, project.default_branch);
    }).then((branch) => prisma.session.update({ where: { id: session.id }, data: { commitSha: assertCommit(branch.commit.id) } }))
    .then((updated) => updated.commitSha!);
  return resolveCommit.then((headSha) => prepareRunWorkspace(session, { id: `chat-${session.id}-${headSha}`, baseSha: headSha, headSha }, signal))
    .then((workspace) => ({ ...workspace, diffRef: null }));
}

export function cleanupRunWorkspaces(): Promise<void> {
  const cutoff = new Date(Date.now() - workspaceConfig.ttlMs);
  return directories(workspaceConfig.root).then((repositories) => repositories.reduce<Promise<void>>((pending, repoId) => pending.then(() => {
    const previous = locks.get(repoId) ?? Promise.resolve();
    const root = path.join(workspaceConfig.root, repoId);
    const next = previous.catch(() => undefined).then(() => ["runs", "artifacts"].reduce<Promise<void>>((sequence, family) => sequence
      .then(() => directories(path.join(root, family)))
      .then((ids) => ids.reduce<Promise<void>>((items, id) => items.then(() => {
        const dir = path.join(root, family, id);
        return stat(dir).then((info) => {
          if (info.mtime >= cutoff) return;
          return prisma.run.findUnique({ where: { id }, select: { status: true, finishedAt: true } }).then((run) => {
            if (run && (!run.finishedAt || run.finishedAt >= cutoff || ["queued", "running", "cancelling"].includes(run.status))) return;
            return family === "runs" ? executeChecked("git", ["--git-dir", path.join(root, "repo.git"), "worktree", "remove", "--force", dir]).then(() => undefined)
              : rm(dir, { recursive: true });
          });
        });
      }), Promise.resolve())), Promise.resolve()));
    locks.set(repoId, next);
    return next.finally(() => { if (locks.get(repoId) === next) locks.delete(repoId); }).then(() => undefined);
  }), Promise.resolve()));
}

function directories(dir: string): Promise<string[]> {
  return readdir(dir, { withFileTypes: true }).then((entries) => entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name), (error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return [];
  });
}

export type Workspace = { dir: string; diffRef: string | null };
