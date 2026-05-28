/**
 * @file refresh-memory.ts
 * @description LangGraph 节点：刷新仓库 Memory Wiki 和轻量 Code Graph
 */

import { memoryIndexService } from "@/lib/services/memory-index";
import type { ReviewState } from "../types";

export function refreshMemoryNode(state: ReviewState): Promise<Partial<ReviewState>> {
  console.log("🧠 [RefreshMemoryNode] Refreshing repository memory");

  const reviewLog = state.reviewLog;
  if (!reviewLog) {
    return Promise.reject(new Error("Review log is required before refreshing memory"));
  }

  const branch = reviewLog.targetBranch || reviewLog.sourceBranch || "default";

  return memoryIndexService.refreshRepositoryMemory({
    repositoryId: reviewLog.repositoryId,
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
