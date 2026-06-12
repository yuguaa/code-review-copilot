/**
 * @file generate-summary.ts
 * @description 审查步骤：生成确定性变更摘要
 *
 * 智能审查只在 Pi Runtime 内执行；这里仅根据 diff 生成可追溯的结构化摘要，
 * 供 Pi Prompt 和最终评论使用。
 */

import { prisma } from "@/lib/prisma";
import type { GitLabDiff } from "@/lib/types";
import type { ReviewState } from "../types";
import { createLogger } from "@/lib/logger";

const log = createLogger("GenerateSummaryStep");

function changedPath(diff: GitLabDiff): string {
  return diff.new_path || diff.old_path;
}

function changeKind(diff: GitLabDiff): string {
  if (diff.deleted_file) return "删除";
  if (diff.new_file) return "新增";
  if (diff.renamed_file) return "重命名";
  return "修改";
}

function summarizeDiff(diff: GitLabDiff): string {
  const added = diff.diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
  const removed = diff.diff.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
  return `- ${changeKind(diff)} \`${changedPath(diff)}\`：+${added} / -${removed}`;
}

function buildDeterministicSummary(state: ReviewState): string {
  const reviewLog = state.reviewLog;
  if (!reviewLog) {
    throw new Error("Review log is required before generating summary");
  }

  const scopeText = state.reviewScope === "incremental"
    ? `Push 增量范围：${state.incrementalBaseSha || "unknown"} -> ${reviewLog.commitSha}`
    : "MR/Commit 全量范围";
  const files = state.relevantDiffs.length > 0 ? state.relevantDiffs : state.diffs;
  const fileLines = files.slice(0, 30).map(summarizeDiff);
  const omitted = files.length > fileLines.length ? [`- 另有 ${files.length - fileLines.length} 个文件未展开显示。`] : [];

  return [
    "### 高层总结",
    `${scopeText}，本次变更涉及 ${files.length} 个可审查文件。`,
    reviewLog.title ? `变更主题：${reviewLog.title}` : "",
    "",
    "### 技术走查",
    ...fileLines,
    ...omitted,
  ].filter(Boolean).join("\n");
}

/**
 * 生成确定性变更摘要
 */
export function generateSummaryStep(state: ReviewState): Promise<Partial<ReviewState>> {
  log.info("📝 [GenerateSummaryStep] Generating deterministic change summary");

  const summary = buildDeterministicSummary(state);
  return prisma.reviewLog.update({
    where: { id: state.reviewLogId },
    data: { changeSummary: summary },
  }).then(() => ({
    summary,
  }));
}
