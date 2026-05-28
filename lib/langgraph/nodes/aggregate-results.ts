/**
 * @file aggregate-results.ts
 * @description LangGraph 节点：汇总审查结果
 *
 * 此节点负责：
 * 1. 统计所有文件的审查结果
 * 2. 汇总问题数量
 * 3. 保存审查结果到数据库
 */

import { prisma } from "@/lib/prisma";
import type { ReviewState, ReviewStatistics } from "../types";
import type { ReviewComment } from "@/lib/types";

const MIN_CONFIDENCE = 0.6;

function normalizeComments(comments: ReviewComment[]): ReviewComment[] {
  const seen = new Set<string>();
  return comments
    .filter((comment) => {
      const confidence = comment.confidence ?? 0.7;
      return Number.isFinite(confidence) && confidence >= MIN_CONFIDENCE && confidence <= 1;
    })
    .filter((comment) => {
      const key = [
        comment.filePath,
        comment.lineNumber,
        comment.lineRangeEnd || "",
        comment.severity,
        comment.content.replace(/\s+/g, " ").trim(),
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 50);
}

/**
 * 汇总审查结果节点
 */
export async function aggregateResultsNode(state: ReviewState): Promise<Partial<ReviewState>> {
  console.log(`📊 [AggregateResultsNode] Aggregating review results`);

  // 最终发布口径以过滤、去重后的评论为准。
  const commentsToSave = normalizeComments(
    state.reviewComments.length > 0
      ? state.reviewComments
      : state.criticalComments,
  );
  const totalCritical = commentsToSave.filter((comment) => comment.severity === "critical").length;
  const totalNormal = commentsToSave.filter((comment) => comment.severity === "normal").length;
  const totalSuggestion = commentsToSave.filter((comment) => comment.severity === "suggestion").length;

  const statistics: ReviewStatistics = {
    critical: totalCritical,
    normal: totalNormal,
    suggestion: totalSuggestion,
    total: totalCritical + totalNormal + totalSuggestion,
  };

  console.log(`📊 [AggregateResultsNode] Review complete:`);
  console.log(`   🔴 Critical: ${statistics.critical}`);
  console.log(`   ⚠️ Normal: ${statistics.normal}`);
  console.log(`   💡 Suggestions: ${statistics.suggestion}`);

  await prisma.$transaction(async (tx) => {
    if (commentsToSave.length > 0) {
      await tx.reviewComment.createMany({
        data: commentsToSave.map((comment) => ({
          reviewLogId: state.reviewLogId,
          filePath: comment.filePath,
          lineNumber: comment.lineNumber,
          lineRangeEnd: comment.lineRangeEnd,
          severity: comment.severity,
          content: comment.content,
          diffHunk: comment.diffHunk,
          confidence: comment.confidence,
        })),
      });
    }

    await tx.reviewLog.update({
      where: { id: state.reviewLogId },
      data: {
        status: "completed",
        completedAt: new Date(),
        criticalIssues: statistics.critical,
        normalIssues: statistics.normal,
        suggestions: statistics.suggestion,
        aiResponse: JSON.stringify(state.aiResponsesByFile),
        reviewPrompts: JSON.stringify(state.reviewPromptsByFile),
        aiModelProvider: state.modelConfig.provider,
        aiModelId: state.modelConfig.modelId,
      },
    });
  });

  return {
    statistics,
  };
}
