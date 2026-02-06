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

/**
 * 生成变更摘要节点
 */
export async function generateSummaryNode(state: ReviewState): Promise<Partial<ReviewState>> {
  console.log(`📝 [GenerateSummaryNode] Generating change summary`);

  const allDiffsText = state.diffs.map((d) => d.diff).join("\n");
  const summaryPrompt = buildSummaryPrompt({
    title: state.mrInfo?.title || state.reviewLog?.title || "",
    description: state.mrInfo?.description || state.reviewLog?.description || "",
    diffs: allDiffsText,
  });

  const summary = await aiService.reviewCode(
    summaryPrompt,
    state.modelConfig,
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
