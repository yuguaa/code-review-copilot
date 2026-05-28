/**
 * @file run-agent-loop.ts
 * @description LangGraph 节点：执行单 Agent 有界循环
 */

import { reviewAgentLoopService } from "@/lib/services/review-agent-loop";
import type { ReviewState } from "../types";

export function runAgentLoopNode(state: ReviewState): Promise<Partial<ReviewState>> {
  console.log("🔁 [RunAgentLoopNode] Running bounded review agent loop");

  const reviewLog = state.reviewLog;
  if (!reviewLog) {
    return Promise.reject(new Error("Review log is required before running agent loop"));
  }
  if (!state.reviewBotRunId) {
    return Promise.reject(new Error("Review bot run is required before running agent loop"));
  }

  const branch = reviewLog.targetBranch || reviewLog.sourceBranch || "default";
  const changedFiles = state.relevantDiffs.map((diff) => diff.new_path);
  const diffs = state.relevantDiffs.map((diff) => ({
    filePath: diff.new_path,
    diff: `--- a/${diff.old_path}
+++ b/${diff.new_path}
${diff.diff}`,
  }));

  return reviewAgentLoopService.run({
    reviewLogId: state.reviewLogId,
    reviewBotRunId: state.reviewBotRunId,
    repositoryId: reviewLog.repositoryId,
    branch,
    commitSha: reviewLog.commitSha,
    title: reviewLog.title,
    description: reviewLog.description,
    changedFiles,
    diffs,
    modelConfig: state.modelConfig,
    memorySnapshotId: state.memorySnapshotId,
    existingFindings: state.reviewComments,
  }).then((result) => ({
    agentTraceId: result.traceId,
    agentPlan: result.finalPlan as Record<string, unknown>,
    agentContextSummary: result.context.summary,
    architectureSummary: result.context.architectureSummary,
    reviewComments: result.agentFindings,
    criticalComments: result.agentFindings.filter((item) => item.severity === "critical"),
  })).catch((error) => {
    console.error("❌ [RunAgentLoopNode] Agent loop failed", error);
    throw error;
  });
}
