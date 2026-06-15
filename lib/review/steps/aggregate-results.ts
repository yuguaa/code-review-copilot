/**
 * @file aggregate-results.ts
 * @description 审查步骤：汇总审查结果
 *
 * 此步骤负责：
 * 1. 统计所有文件的审查结果
 * 2. 汇总问题数量
 * 3. 保存审查结果到数据库
 */

import { prisma } from "@/lib/prisma";
import { buildFindingKey, toPrismaJsonInput } from "@/lib/review/utils";
import type { ReviewState, ReviewStatistics } from "../types";
import type { ReviewComment } from "@/lib/types";
import { createLogger } from "@/lib/logger";
import { REVIEW_CANCELLED_STATUS, ReviewCancelledError } from "@/lib/services/review-cancellation";

const log = createLogger("AggregateResultsStep");

function normalizeComments(comments: ReviewComment[]): ReviewComment[] {
  const seen = new Set<string>();
  return comments
    .filter((comment) => {
      const key = buildFindingKey(comment);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((comment) => ({
      ...comment,
      confidence: Math.min(1, Math.max(0, comment.confidence ?? 0.5)),
    }));
}

/**
 * 汇总审查结果
 */
export function aggregateResultsStep(state: ReviewState): Promise<Partial<ReviewState>> {
  log.info(`📊 [AggregateResultsStep] Aggregating review results`);

  // 最终发布口径以去重后的评论为准，confidence 只用于内部排序和去重。
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

  log.info(`📊 [AggregateResultsStep] Review complete:`);
  log.info(`   🔴 Critical: ${statistics.critical}`);
  log.info(`   ⚠️ Normal: ${statistics.normal}`);
  log.info(`   💡 Suggestions: ${statistics.suggestion}`);

  return prisma.$transaction((tx) => {
    const writeComments = commentsToSave.length > 0
      ? tx.reviewComment.createMany({
        data: commentsToSave.map((comment) => ({
          reviewLogId: state.reviewLogId,
          piReviewRunId: comment.piReviewRunId,
          filePath: comment.filePath,
          lineNumber: comment.lineNumber,
          lineRangeEnd: comment.lineRangeEnd,
          severity: comment.severity,
          content: comment.content,
          sourceProfileName: comment.sourceProfileName,
          sourceProfileModel: comment.sourceProfileModel,
          sourceProfilesJson: comment.sourceProfiles ? toPrismaJsonInput(comment.sourceProfiles) : undefined,
          diffHunk: comment.diffHunk,
          confidence: comment.confidence,
        })),
      }).then(() => undefined)
      : Promise.resolve();

    return writeComments.then(() => tx.reviewLog.updateMany({
      where: { id: state.reviewLogId, status: "pending" },
      data: {
        reviewedFiles: state.relevantDiffs.length,
        criticalIssues: statistics.critical,
        normalIssues: statistics.normal,
        suggestions: statistics.suggestion,
        piRawOutputs: JSON.stringify(state.piRawOutputsByFile),
        piPrompts: JSON.stringify(state.piPromptsByFile),
      },
    })).then((updateResult) => {
      if (updateResult.count > 0) return undefined;

      return tx.reviewLog.findUnique({
        where: { id: state.reviewLogId },
        select: { status: true },
      }).then((reviewLog) => {
        if (reviewLog?.status === REVIEW_CANCELLED_STATUS) {
          throw new ReviewCancelledError(state.reviewLogId);
        }
        throw new Error("Review log is no longer pending");
      });
    });
  }).then(() => ({
    statistics,
  }));
}
