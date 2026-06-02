/**
 * @file code-graph-refresh.ts
 * @description Code Graph 刷新服务，供手动刷新接口和定时任务共用。
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createGitLabService } from "@/lib/services/gitlab";
import { memoryIndexService } from "@/lib/services/memory-index";
import type { GitLabDiff } from "@/lib/types";

type RepositoryWithGitLabAccount = Prisma.RepositoryGetPayload<{
  include: { gitLabAccount: true };
}>;

type SnapshotLike = {
  id: string;
  commitSha: string;
  status: string;
  lastIndexedAt: Date | string;
  architectureSummary: string;
  memoryJson?: Prisma.JsonValue | null;
};

export type CodeGraphSnapshotSummary = {
  id: string;
  commitSha: string;
  status: string;
  lastIndexedAt: string;
  architectureSummary: string;
  updateMode: string | null;
  baseBranch: string | null;
  baseCommitSha: string | null;
  sourceCommitSha: string | null;
  indexedFiles: number | null;
};

type RefreshRepositoryCodeGraphInput = {
  repositoryId: string;
  branch?: string;
  forceRebuild?: boolean;
};

type RefreshRepositoryBranchInput = {
  repository: RepositoryWithGitLabAccount;
  branch: string;
  forceRebuild: boolean;
};

type ScheduledRepository = Prisma.RepositoryGetPayload<{
  include: {
    gitLabAccount: true;
    memorySnapshots: {
      select: { branch: true };
    };
  };
}>;

export type CodeGraphRefreshResult = {
  success: true;
  repositoryId: string;
  branch: {
    name: string;
    headCommitSha: string;
    committedDate: string | null;
  };
  snapshot: CodeGraphSnapshotSummary;
};

export type ScheduledCodeGraphRefreshSummary = {
  totalRepositories: number;
  totalBranches: number;
  successCount: number;
  failureCount: number;
  failures: Array<{
    repositoryId: string;
    repositoryName: string;
    branch: string;
    error: string;
  }>;
};

export class CodeGraphRefreshError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "CodeGraphRefreshError";
    this.statusCode = statusCode;
  }
}

function readMemoryString(memoryJson: unknown, key: string): string | null {
  if (!memoryJson || typeof memoryJson !== "object" || Array.isArray(memoryJson)) return null;
  const value = (memoryJson as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function readMemoryNumber(memoryJson: unknown, key: string): number | null {
  if (!memoryJson || typeof memoryJson !== "object" || Array.isArray(memoryJson)) return null;
  const value = (memoryJson as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function toCodeGraphSnapshotSummary(snapshot: SnapshotLike): CodeGraphSnapshotSummary {
  return {
    id: snapshot.id,
    commitSha: snapshot.commitSha,
    status: snapshot.status,
    lastIndexedAt: normalizeDate(snapshot.lastIndexedAt),
    architectureSummary: snapshot.architectureSummary,
    updateMode: readMemoryString(snapshot.memoryJson, "updateMode"),
    baseBranch: readMemoryString(snapshot.memoryJson, "baseBranch"),
    baseCommitSha: readMemoryString(snapshot.memoryJson, "baseCommitSha"),
    sourceCommitSha: readMemoryString(snapshot.memoryJson, "sourceCommitSha"),
    indexedFiles: readMemoryNumber(snapshot.memoryJson, "indexedFiles"),
  };
}

function resolveDefaultBranch(watchBranches: string | null): string {
  const watchedBranch = watchBranches
    ?.split(",")
    .map((item) => item.trim())
    .find((item) => item && !item.includes("*"));
  return watchedBranch || "main";
}

function resolveScheduledBranches(repository: ScheduledRepository): string[] {
  const branches = new Set<string>();
  repository.memorySnapshots.forEach((snapshot) => {
    if (snapshot.branch) branches.add(snapshot.branch);
  });
  repository.watchBranches
    ?.split(",")
    .map((item) => item.trim())
    .filter((item) => item && !item.includes("*"))
    .forEach((branch) => branches.add(branch));

  if (branches.size === 0) {
    branches.add(resolveDefaultBranch(repository.watchBranches));
  }

  return [...branches];
}

function resolveDiffs(input: {
  repository: RepositoryWithGitLabAccount;
  branch: string;
  commitSha: string;
  previousIndexedCommitSha: string | null;
  forceRebuild: boolean;
  gitlabService: ReturnType<typeof createGitLabService>;
}): Promise<GitLabDiff[]> {
  if (input.forceRebuild) return Promise.resolve([]);
  if (input.previousIndexedCommitSha === input.commitSha) return Promise.resolve([]);
  if (input.previousIndexedCommitSha) {
    return input.gitlabService
      .compareCommits(input.repository.gitLabProjectId, input.previousIndexedCommitSha, input.commitSha)
      .then((result) => result.diffs);
  }
  return input.gitlabService.getCommitDiff(input.repository.gitLabProjectId, input.commitSha);
}

function refreshRepositoryBranchCodeGraph(input: RefreshRepositoryBranchInput): Promise<CodeGraphRefreshResult> {
  const gitlabService = createGitLabService(
    input.repository.gitLabAccount.url,
    input.repository.gitLabAccount.accessToken,
  );

  return gitlabService.getBranch(input.repository.gitLabProjectId, input.branch)
    .then((remoteBranch) => {
      const commitSha = remoteBranch.commit.id;
      if (!commitSha) {
        throw new Error(`Cannot resolve latest commit for branch ${input.branch}`);
      }

      return prisma.repositoryMemorySnapshot.findFirst({
        where: { repositoryId: input.repository.id, branch: input.branch, status: "ready" },
        orderBy: { lastIndexedAt: "desc" },
      }).then((existingSnapshot) => {
        const previousIndexedCommitSha = existingSnapshot?.commitSha || null;
        return resolveDiffs({
          repository: input.repository,
          branch: input.branch,
          commitSha,
          previousIndexedCommitSha,
          forceRebuild: input.forceRebuild,
          gitlabService,
        }).then((diffs) => memoryIndexService.refreshRepositoryMemory({
          repositoryId: input.repository.id,
          gitLabProjectId: input.repository.gitLabProjectId,
          gitlabService,
          branch: input.branch,
          commitSha,
          diffs,
          forceRebuild: input.forceRebuild,
          previousIndexedCommitSha,
          baseBranch: existingSnapshot && !input.forceRebuild ? input.branch : null,
          baseCommitSha: existingSnapshot && !input.forceRebuild ? existingSnapshot.commitSha : null,
        })).then((snapshot) => ({
          success: true as const,
          repositoryId: input.repository.id,
          branch: {
            name: input.branch,
            headCommitSha: commitSha,
            committedDate: remoteBranch.commit.created_at || null,
          },
          snapshot: toCodeGraphSnapshotSummary(snapshot),
        }));
      });
    });
}

function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;

  const runNext = (): Promise<void> => {
    const index = cursor;
    cursor += 1;
    if (index >= items.length) return Promise.resolve();

    return worker(items[index])
      .then((result) => {
        results[index] = result;
      })
      .then(runNext);
  };

  return Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, runNext),
  ).then(() => results);
}

export function refreshRepositoryCodeGraph(
  input: RefreshRepositoryCodeGraphInput,
): Promise<CodeGraphRefreshResult> {
  return prisma.repository.findUnique({
    where: { id: input.repositoryId },
    include: { gitLabAccount: true },
  }).then((repository) => {
    if (!repository) {
      throw new CodeGraphRefreshError("Repository not found", 404);
    }

    return refreshRepositoryBranchCodeGraph({
      repository,
      branch: input.branch?.trim() || resolveDefaultBranch(repository.watchBranches),
      forceRebuild: Boolean(input.forceRebuild),
    });
  });
}

export function refreshScheduledCodeGraphs(): Promise<ScheduledCodeGraphRefreshSummary> {
  return prisma.repository.findMany({
    where: { isActive: true },
    include: {
      gitLabAccount: true,
      memorySnapshots: {
        where: { status: "ready" },
        select: { branch: true },
        orderBy: { lastIndexedAt: "desc" },
        take: 100,
      },
    },
    orderBy: { name: "asc" },
  }).then((repositories) => {
    const jobs = repositories.flatMap((repository) => {
      return resolveScheduledBranches(repository).map((branch) => ({ repository, branch }));
    });

    return mapWithConcurrency(jobs, 2, (job) => {
      return refreshRepositoryBranchCodeGraph({
        repository: job.repository,
        branch: job.branch,
        forceRebuild: false,
      }).then(() => ({
        ok: true as const,
        repositoryId: job.repository.id,
        repositoryName: job.repository.name,
        branch: job.branch,
      })).catch((error) => ({
        ok: false as const,
        repositoryId: job.repository.id,
        repositoryName: job.repository.name,
        branch: job.branch,
        error: error instanceof Error ? error.message : "刷新 Code Graph 失败",
      }));
    }).then((results) => {
      const failures = results.filter((result): result is Extract<typeof result, { ok: false }> => !result.ok);
      return {
        totalRepositories: repositories.length,
        totalBranches: jobs.length,
        successCount: results.length - failures.length,
        failureCount: failures.length,
        failures: failures.map(({ repositoryId, repositoryName, branch, error }) => ({
          repositoryId,
          repositoryName,
          branch,
          error,
        })),
      };
    });
  });
}
