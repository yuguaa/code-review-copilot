/**
 * @file generate-summary.ts
 * @description 审查步骤：生成变更摘要
 *
 * 此步骤负责：
 * 1. 收集所有 diff 内容
 * 2. 调用 AI 生成变更摘要
 * 3. 将摘要保存到数据库和状态中
 */

import { prisma } from "@/lib/prisma";
import { aiService } from "@/lib/services/ai";
import { buildSummaryPrompt, SUMMARY_SYSTEM_PROMPT } from "@/lib/prompts";
import { toModelConfig } from "@/lib/review/utils";
import type { ReviewState } from "../types";
import { createLogger } from "@/lib/logger";

const log = createLogger("GenerateSummaryStep");

/**
 * 生成变更摘要
 */
export function generateSummaryStep(state: ReviewState): Promise<Partial<ReviewState>> {
  log.info(`📝 [GenerateSummaryStep] Generating change summary`);

  const reviewLog = state.reviewLog;
  if (!reviewLog) {
    return Promise.reject(new Error("Review log is required before generating summary"));
  }

  return prisma.repositoryReviewBot.findFirst({
    where: {
      repositoryId: reviewLog.repositoryId,
      isActive: true,
      aiModel: { isActive: true },
    },
    include: { aiModel: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  }).then((primaryBot) => {
    if (!primaryBot) {
      throw new Error("No active review bots configured");
    }

    const modelConfig = toModelConfig(primaryBot.aiModel);
    const allDiffsText = state.diffs.map((d) => d.diff).join("\n");
    const summaryPrompt = buildSummaryPrompt({
      title: state.mrInfo?.title || reviewLog.title || "",
      description: state.mrInfo?.description || reviewLog.description || "",
      diffs: allDiffsText,
      reviewScope: state.reviewScope,
      baseCommitSha: state.incrementalBaseSha,
      headCommitSha: reviewLog.commitSha,
    });

    return aiService.reviewCode(
      summaryPrompt,
      modelConfig,
      SUMMARY_SYSTEM_PROMPT,
    );
  }).then((summary) => {
    log.info(`✅ [GenerateSummaryStep] Summary generated: ${summary.slice(0, 100)}...`);

    // 保存摘要到数据库
    return prisma.reviewLog.update({
      where: { id: state.reviewLogId },
      data: { aiSummary: summary },
    }).then(() => ({
      summary,
    }));
  });
}
