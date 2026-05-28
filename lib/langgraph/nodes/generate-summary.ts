/**
 * @file generate-summary.ts
 * @description LangGraph 节点：生成变更摘要
 *
 * 此节点负责：
 * 1. 收集所有 diff 内容
 * 2. 调用 AI 生成变更摘要
 * 3. 将摘要保存到数据库和状态中
 */

import { prisma } from "@/lib/prisma";
import { aiService } from "@/lib/services/ai";
import { buildSummaryPrompt, SUMMARY_SYSTEM_PROMPT } from "@/lib/prompts";
import type { ReviewState } from "../types";
import type { AIModelConfig } from "@/lib/types";

function toModelConfig(model: {
  id: string;
  provider: string;
  modelId: string;
  apiKey: string;
  apiEndpoint: string | null;
  maxTokens: number | null;
  temperature: number | null;
  isActive: boolean;
}): AIModelConfig {
  return {
    id: model.id,
    name: model.modelId,
    provider: model.provider as AIModelConfig["provider"],
    modelId: model.modelId,
    apiKey: model.apiKey,
    apiEndpoint: model.apiEndpoint || undefined,
    maxTokens: model.maxTokens || undefined,
    temperature: model.temperature || undefined,
    isActive: model.isActive,
  };
}

/**
 * 生成变更摘要节点
 */
export async function generateSummaryNode(state: ReviewState): Promise<Partial<ReviewState>> {
  console.log(`📝 [GenerateSummaryNode] Generating change summary`);

  const reviewLog = state.reviewLog;
  if (!reviewLog) {
    throw new Error("Review log is required before generating summary");
  }

  const primaryBot = await prisma.repositoryReviewBot.findFirst({
    where: {
      repositoryId: reviewLog.repositoryId,
      isActive: true,
      aiModel: { isActive: true },
    },
    include: { aiModel: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
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

  const summary = await aiService.reviewCode(
    summaryPrompt,
    modelConfig,
    SUMMARY_SYSTEM_PROMPT,
  );

  console.log(`✅ [GenerateSummaryNode] Summary generated: ${summary.slice(0, 100)}...`);

  // 保存摘要到数据库
  await prisma.reviewLog.update({
    where: { id: state.reviewLogId },
    data: { aiSummary: summary },
  });

  return {
    summary,
  };
}
