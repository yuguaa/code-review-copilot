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

/**
 * 汇总审查结果节点
 */
export async function aggregateResultsNode(state: ReviewState): Promise<Partial<ReviewState>> {
  console.log(`📊 [AggregateResultsNode] Aggregating review results`);

  // 统计所有文件的问题数量
  let totalCritical = 0;
  let totalNormal = 0;
  let totalSuggestion = 0;

  for (const result of state.fileResults) {
    totalCritical += result.counts.critical;
    totalNormal += result.counts.normal;
    totalSuggestion += result.counts.suggestion;
  }

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

  // 保存问题到数据库（严重/一般/建议）
  const commentsToSave = state.reviewComments.length > 0
    ? state.reviewComments
    : state.criticalComments;

  for (const comment of commentsToSave.slice(0, 24)) {
    await prisma.reviewComment.create({
      data: {
        reviewLogId: state.reviewLogId,
        filePath: comment.filePath,
        lineNumber: comment.lineNumber,
        lineRangeEnd: comment.lineRangeEnd,
        severity: comment.severity,
        content: comment.content,
        diffHunk: comment.diffHunk,
      },
    });
  }

  // 更新审查状态
  await prisma.reviewLog.update({
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

  return {
    statistics,
  };
}
