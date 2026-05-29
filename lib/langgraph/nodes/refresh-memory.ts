/**
 * @file refresh-memory.ts
 * @description 工作流节点：刷新仓库 Code Graph
 */

import { memoryIndexService } from "@/lib/services/memory-index";
import { prisma } from "@/lib/prisma";
import type { ReviewState } from "../types";

export function refreshMemoryNode(state: ReviewState): Promise<Partial<ReviewState>> {
  console.log("🧠 [RefreshMemoryNode] Refreshing repository memory");

  const reviewLog = state.reviewLog;
  if (!reviewLog) {
    return Promise.reject(new Error("Review log is required before refreshing memory"));
  }
  if (!state.gitlabService) {
    return Promise.reject(new Error("GitLab service is required before refreshing memory"));
  }

  const reviewLogWithRepository = reviewLog as typeof reviewLog & {
    repository?: { gitLabProjectId?: number | string };
  };
  const gitLabProjectId = reviewLogWithRepository.repository?.gitLabProjectId;
  if (!gitLabProjectId) {
    return Promise.reject(new Error("GitLab project id is required before refreshing memory"));
  }

  const branch = reviewLog.sourceBranch || "default";
  const graphCommitSha = reviewLog.commitSha;

  const loadBaseSnapshot = prisma.repositoryMemorySnapshot.findFirst({
    where: {
      repositoryId: reviewLog.repositoryId,
      branch,
      status: "ready",
      commitSha: { not: graphCommitSha },
    },
    orderBy: { lastIndexedAt: "desc" },
  });

  return loadBaseSnapshot
    .then((baseSnapshot) => {
      if (!baseSnapshot) {
        return memoryIndexService.refreshRepositoryMemory({
          repositoryId: reviewLog.repositoryId,
          gitLabProjectId,
          gitlabService: state.gitlabService!,
          branch,
          commitSha: graphCommitSha,
          diffs: state.relevantDiffs,
          sourceCommitSha: reviewLog.commitSha,
          previousIndexedCommitSha: null,
          forceRebuild: true,
        });
      }

      return memoryIndexService.refreshRepositoryMemory({
        repositoryId: reviewLog.repositoryId,
        gitLabProjectId,
        gitlabService: state.gitlabService!,
        branch,
        commitSha: graphCommitSha,
        diffs: state.relevantDiffs,
        sourceCommitSha: reviewLog.commitSha,
        previousIndexedCommitSha: baseSnapshot.commitSha,
        baseBranch: branch,
        baseCommitSha: baseSnapshot.commitSha,
      });
    })
    .then((snapshot) => ({
      memorySnapshotId: snapshot.id,
      architectureSummary: snapshot.architectureSummary,
    })).catch((error) => {
    console.error("❌ [RefreshMemoryNode] Failed to refresh memory", error);
    throw error;
  });
}
