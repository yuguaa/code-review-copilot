/**
 * @file review-file.ts
 * @description LangGraph 节点：审查单个文件
 *
 * 此节点负责：
 * 1. 获取当前待审查的文件
 * 2. 构建 prompt（支持自定义提示词 extend/replace 模式）
 * 3. 调用 AI 进行审查
 * 4. 解析审查结果
 * 5. 更新数据库进度
 */

import { prisma } from "@/lib/prisma";
import { aiService } from "@/lib/services/ai";
import { buildReviewPrompt, SYSTEM_PROMPT, OUTPUT_FORMAT } from "@/lib/prompts";
import type { ReviewState, FileReviewResult } from "../types";

/**
 * 生成 patch 格式
 */
function generatePatch(diff: any): string {
  return `--- a/${diff.old_path}
+++ b/${diff.new_path}
${diff.diff}`;
}

/**
 * 审查单个文件节点
 */
export async function reviewFileNode(state: ReviewState): Promise<Partial<ReviewState>> {
  const index = state.currentFileIndex;
  console.log(`🔍 [ReviewFileNode] Starting with currentFileIndex=${index}, relevantDiffs.length=${state.relevantDiffs.length}`);
  console.log(`🔍 [ReviewFileNode] Full state:`, JSON.stringify({
    currentFileIndex: state.currentFileIndex,
    relevantDiffsLength: state.relevantDiffs.length,
    fileResultsLength: state.fileResults?.length || 0,
    currentFile: state.currentFile,
  }));

  if (index >= state.relevantDiffs.length) {
    console.log(`⏭️ [ReviewFileNode] No more files to review (index=${index} >= length=${state.relevantDiffs.length})`);
    // 返回一个标志，表示已经完成
    return {
      completed: true,
    };
  }

  const diff = state.relevantDiffs[index];
  const filePath = diff.new_path;

  console.log(`📄 [ReviewFileNode] Reviewing file [${index + 1}/${state.relevantDiffs.length}]: ${filePath}`);

  const patch = generatePatch(diff);

  // 构建系统提示词（支持 extend/replace 模式）
  let systemPrompt = SYSTEM_PROMPT;

  if (state.repositoryConfig.customPrompt) {
    const promptMode = state.repositoryConfig.customPromptMode || "extend";
    if (promptMode === "replace") {
      systemPrompt = state.repositoryConfig.customPrompt + OUTPUT_FORMAT;
    } else {
      systemPrompt = `${SYSTEM_PROMPT}\n\n【仓库自定义要求】\n${state.repositoryConfig.customPrompt}`;
    }
  }

  const reviewPrompt = buildReviewPrompt({
    title: state.mrInfo?.title || state.reviewLog?.title || "",
    description: state.mrInfo?.description || state.reviewLog?.description || "",
    filename: filePath,
    diff: patch,
    summary: state.summary,
  });

  // 记录完整的 prompt（包含系统提示词）
  const fullPrompt = `=== System Prompt ===\n${systemPrompt}\n\n=== User Prompt ===\n${reviewPrompt}`;

  const aiResponse = await aiService.reviewCode(
    reviewPrompt,
    state.modelConfig,
    systemPrompt,
  );

  // 调试：打印 AI 响应
  console.log(`\n🤖 [ReviewFileNode] AI Response for ${filePath}:`);
  console.log("┌─────────────────────────────────────────────┐");
  aiResponse.split("\n").forEach((line) => console.log(`│ ${line}`));
  console.log("└─────────────────────────────────────────────┘");

  // 解析结果
  const parsed = aiService.parseReviewSummary(aiResponse, {
    defaultFilePath: filePath,
    maxCriticalItems: 200,
    maxItems: 200,
  });

  // 构建文件审查结果
  const fileResult: FileReviewResult = {
    filePath,
    aiResponse,
    prompt: fullPrompt,
    counts: {
      critical: parsed.counts.critical,
      normal: parsed.counts.normal,
      suggestion: parsed.counts.suggestion,
    },
    criticalItems: parsed.criticalItems.map((item) => ({
      filePath: item.filePath || filePath,
      lineNumber: item.lineNumber,
      lineRangeEnd: item.lineRangeEnd,
      content: item.content,
    })),
    reviewItems: parsed.commentItems.map((item) => ({
      filePath: item.filePath || filePath,
      lineNumber: item.lineNumber,
      lineRangeEnd: item.lineRangeEnd,
      severity: item.severity,
      content: item.content,
    })),
  };

  // 更新数据库进度
  await prisma.reviewLog.update({
    where: { id: state.reviewLogId },
    data: { reviewedFiles: { increment: 1 } },
  });

  // 收集三种级别问题
  const reviewComments = parsed.commentItems.map((item) => ({
    filePath: item.filePath || filePath,
    lineNumber: item.lineNumber,
    lineRangeEnd: item.lineRangeEnd,
    severity: item.severity,
    content: item.content,
  }));
  const criticalComments = reviewComments.filter((item) => item.severity === "critical");

  const result = {
    // 不返回 currentFileIndex，让它保持不变（由 moveToNextFile 负责更新）
    currentFile: {
      filePath,
      diff,
      patch,
    },
    fileResults: [fileResult],
    aiResponsesByFile: {
      [filePath]: aiResponse,
    },
    reviewPromptsByFile: {
      [filePath]: fullPrompt,
    },
    criticalComments,
    reviewComments,
  };
  console.log(`✅ [ReviewFileNode] Completed review for ${filePath}, NOT returning currentFileIndex`);
  return result;
}

/**
 * 检查是否还有更多文件需要审查
 */
export function shouldContinueReview(state: ReviewState): "continue" | "aggregate" {
  // 当前文件索引 + 1 表示下一个要审查的文件
  const nextIndex = state.currentFileIndex + 1;
  console.log(`🔍 [shouldContinueReview] currentFileIndex: ${state.currentFileIndex}, nextIndex: ${nextIndex}, totalDiffs: ${state.relevantDiffs.length}`);
  console.log(`🔍 [shouldContinueReview] State snapshot:`, JSON.stringify({
    currentFileIndex: state.currentFileIndex,
    relevantDiffsLength: state.relevantDiffs.length,
    fileResultsLength: state.fileResults?.length || 0,
  }));

  // 安全检查：如果当前索引已经超出范围，直接结束
  if (state.currentFileIndex >= state.relevantDiffs.length) {
    console.log(`🏁 [shouldContinueReview] Current index already exceeds total, aggregating results`);
    return "aggregate";
  }

  if (nextIndex < state.relevantDiffs.length) {
    console.log(`✅ [shouldContinueReview] Continuing to next file`);
    return "continue";
  }
  console.log(`🏁 [shouldContinueReview] All files reviewed, aggregating results`);
  return "aggregate";
}

/**
 * 移动到下一个文件
 */
export async function moveToNextFile(state: ReviewState): Promise<Partial<ReviewState>> {
  const oldIndex = state.currentFileIndex;
  const newIndex = state.currentFileIndex + 1;
  console.log(`➡️ [moveToNextFile] BEFORE: currentFileIndex=${oldIndex}`);
  console.log(`➡️ [moveToNextFile] AFTER: will be ${newIndex}`);
  console.log(`➡️ [moveToNextFile] relevantDiffs.length=${state.relevantDiffs.length}`);
  const result = {
    currentFileIndex: newIndex,
    currentFile: null,
  };
  console.log(`➡️ [moveToNextFile] Returning:`, JSON.stringify(result));
  return result;
}
