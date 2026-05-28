/**
 * @file refresh-memory.ts
 * @description 工作流节点：刷新仓库 Memory Wiki 和轻量 Code Graph
 */

import { memoryIndexService } from "@/lib/services/memory-index";
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

  return memoryIndexService.refreshRepositoryMemory({
    repositoryId: reviewLog.repositoryId,
    gitLabProjectId,
    gitlabService: state.gitlabService,
    branch,
    commitSha: reviewLog.commitSha,
    diffs: state.relevantDiffs,
  }).then((snapshot) => ({
    memorySnapshotId: snapshot.id,
    architectureSummary: snapshot.architectureSummary,
  })).catch((error) => {
    console.error("❌ [RefreshMemoryNode] Failed to refresh memory", error);
    throw error;
  });
}
