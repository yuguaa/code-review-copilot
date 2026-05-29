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

  const branch = reviewLog.targetBranch || reviewLog.sourceBranch || "default";

  return state.gitlabService.getBranch(gitLabProjectId, branch)
    .then((remoteBranch) => {
      const targetBranchHeadSha = remoteBranch.commit.id;
      const targetSnapshotPromise = prisma.repositoryMemorySnapshot.findUnique({
        where: {
          repositoryId_branch_commitSha: {
            repositoryId: reviewLog.repositoryId,
            branch,
            commitSha: targetBranchHeadSha,
          },
        },
      });

      return targetSnapshotPromise.then((targetSnapshot) => {
        const targetGraphPromise = targetSnapshot
          ? Promise.resolve(targetSnapshot)
          : memoryIndexService.refreshRepositoryMemory({
            repositoryId: reviewLog.repositoryId,
            gitLabProjectId,
            gitlabService: state.gitlabService!,
            branch,
            commitSha: targetBranchHeadSha,
            diffs: [],
            sourceCommitSha: targetBranchHeadSha,
            previousIndexedCommitSha: null,
            forceRebuild: true,
          });

        return targetGraphPromise.then(() => {
          const graphCommitSha = reviewLog.commitSha || targetBranchHeadSha;
          const loadGraphDiffs = graphCommitSha === targetBranchHeadSha
            ? Promise.resolve(state.relevantDiffs)
            : Promise.resolve(state.relevantDiffs.length > 0 ? state.relevantDiffs : [])

          return loadGraphDiffs.then((graphDiffs) => memoryIndexService.refreshRepositoryMemory({
            repositoryId: reviewLog.repositoryId,
            gitLabProjectId,
            gitlabService: state.gitlabService!,
            branch,
            commitSha: graphCommitSha,
            diffs: graphDiffs,
            sourceCommitSha: reviewLog.commitSha,
            previousIndexedCommitSha: targetBranchHeadSha,
            baseBranch: branch,
            baseCommitSha: targetBranchHeadSha,
          }));
        });
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
