/**
 * @file refresh-memory.ts
 * @description 工作流节点：刷新仓库 Memory Wiki 和轻量 Code Graph
 */

import { getCodeGraphCacheCommitSha, memoryIndexService } from "@/lib/services/memory-index";
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

  const branch = reviewLog.sourceBranch || reviewLog.targetBranch || "default";

  return state.gitlabService.getBranch(gitLabProjectId, branch)
    .then((remoteBranch) => {
      const branchHeadSha = remoteBranch.commit.id;
      const graphCacheCommitSha = getCodeGraphCacheCommitSha();

      return prisma.repositoryMemorySnapshot.findUnique({
        where: {
          repositoryId_branch_commitSha: {
            repositoryId: reviewLog.repositoryId,
            branch,
            commitSha: graphCacheCommitSha,
          },
        },
      }).then((snapshot) => {
        const memoryJson = snapshot?.memoryJson && typeof snapshot.memoryJson === "object" && !Array.isArray(snapshot.memoryJson)
          ? snapshot.memoryJson as Record<string, unknown>
          : {};
        const previousHeadSha = typeof memoryJson.lastIndexedCommitSha === "string" ? memoryJson.lastIndexedCommitSha : null;
        const loadGraphDiffs = previousHeadSha && previousHeadSha !== branchHeadSha
          ? state.gitlabService!.compareCommits(gitLabProjectId, previousHeadSha, branchHeadSha).then((result) => result.diffs)
          : branchHeadSha === reviewLog.commitSha
            ? Promise.resolve(state.relevantDiffs)
            : state.gitlabService!.getCommitDiff(gitLabProjectId, branchHeadSha);

        return loadGraphDiffs.then((graphDiffs) => memoryIndexService.refreshRepositoryMemory({
          repositoryId: reviewLog.repositoryId,
          gitLabProjectId,
          gitlabService: state.gitlabService!,
          branch,
          commitSha: branchHeadSha,
          diffs: graphDiffs,
          sourceCommitSha: reviewLog.commitSha,
          previousIndexedCommitSha: previousHeadSha,
        }));
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
