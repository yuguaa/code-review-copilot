/**
 * @file run-review-bots.ts
 * @description 并发执行仓库配置的多个审查机器人
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { aiService } from "@/lib/services/ai";
import { reviewAgentLoopService } from "@/lib/services/review-agent-loop";
import { normalizeAgentLoopBudget, totalFindingsBudget } from "@/lib/services/review-budget";
import { buildReviewPrompt, OUTPUT_FORMAT, SYSTEM_PROMPT } from "@/lib/prompts";
import type { AIModelConfig, GitLabDiff, ReviewComment, ReviewCommentSource } from "@/lib/types";
import type { FileReviewResult, ReviewState } from "../types";

type ReviewBotWithModel = Prisma.RepositoryReviewBotGetPayload<{
  include: { aiModel: true };
}>;

type BotRunResult = {
  botRunId: string;
  botName: string;
  botModel: string;
  fileResults: FileReviewResult[];
  comments: ReviewComment[];
  aiResponsesByFile: Record<string, string>;
  reviewPromptsByFile: Record<string, string>;
  summary?: string;
};

function generatePatch(diff: GitLabDiff): string {
  return `--- a/${diff.old_path}
+++ b/${diff.new_path}
${diff.diff}`;
}

function buildSystemPrompt(bot: ReviewBotWithModel): string {
  if (!bot.prompt) return SYSTEM_PROMPT;
  return bot.promptMode === "replace"
    ? `${bot.prompt}\n${OUTPUT_FORMAT}`
    : `${SYSTEM_PROMPT}\n\n【机器人 ${bot.name} 的审查要求】\n${bot.prompt}`;
}

function toModelConfig(bot: ReviewBotWithModel): AIModelConfig {
  return {
    id: bot.aiModel.id,
    name: bot.aiModel.modelId,
    provider: bot.aiModel.provider as AIModelConfig["provider"],
    modelId: bot.aiModel.modelId,
    apiKey: bot.aiModel.apiKey,
    apiEndpoint: bot.aiModel.apiEndpoint || undefined,
    maxTokens: bot.aiModel.maxTokens || undefined,
    temperature: bot.aiModel.temperature || undefined,
    isActive: bot.aiModel.isActive,
  };
}

function sourceFor(botRunId: string, botName: string, botModel: string, confidence?: number): ReviewCommentSource {
  return { reviewBotRunId: botRunId, botName, model: botModel, confidence };
}

function commentKey(comment: ReviewComment): string {
  return [
    comment.filePath,
    comment.lineNumber,
    comment.lineRangeEnd || "",
    comment.severity,
    comment.content.replace(/\s+/g, " ").trim(),
  ].join("|");
}

function mergeComments(comments: ReviewComment[], maxFindings: number): ReviewComment[] {
  const map = new Map<string, ReviewComment>();

  for (const comment of comments) {
    const key = commentKey(comment);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        ...comment,
        confidence: Math.min(1, Math.max(0, comment.confidence ?? 0.5)),
        sourceBots: comment.sourceBots || [],
      });
      continue;
    }

    const sources = [...(existing.sourceBots || []), ...(comment.sourceBots || [])];
    const uniqueSources = Array.from(
      sources.reduce((sourceMap, source) => {
        const current = sourceMap.get(source.reviewBotRunId);
        if (!current || (source.confidence ?? 0) > (current.confidence ?? 0)) {
          sourceMap.set(source.reviewBotRunId, source);
        }
        return sourceMap;
      }, new Map<string, ReviewCommentSource>()).values(),
    );

    map.set(key, {
      ...existing,
      confidence: Math.max(existing.confidence ?? 0, comment.confidence ?? 0),
      sourceBots: uniqueSources,
      sourceBotName: uniqueSources.map((source) => source.botName).join("、"),
      sourceBotModel: uniqueSources.map((source) => source.model).join("、"),
    });
  }

  return [...map.values()].slice(0, maxFindings);
}

function countsFrom(comments: ReviewComment[]) {
  return {
    critical: comments.filter((item) => item.severity === "critical").length,
    normal: comments.filter((item) => item.severity === "normal").length,
    suggestion: comments.filter((item) => item.severity === "suggestion").length,
  };
}

function runFileReviews(params: {
  state: ReviewState;
  bot: ReviewBotWithModel;
  botRunId: string;
  modelConfig: AIModelConfig;
  systemPrompt: string;
  existingFindings: ReviewComment[];
}): Promise<BotRunResult> {
  const aiResponsesByFile: Record<string, string> = {};
  const reviewPromptsByFile: Record<string, string> = {};
  const fileResults: FileReviewResult[] = [];
  const comments: ReviewComment[] = [];
  const botModel = `${params.modelConfig.provider}/${params.modelConfig.modelId}`;
  const budget = normalizeAgentLoopBudget(params.bot);

  const reviewNext = (index: number): Promise<void> => {
    const diff = params.state.relevantDiffs[index];
    if (!diff) return Promise.resolve();

    const filePath = diff.new_path;
    const patch = generatePatch(diff);
    const reviewPrompt = buildReviewPrompt({
      title: params.state.mrInfo?.title || params.state.reviewLog?.title || "",
      description: params.state.mrInfo?.description || params.state.reviewLog?.description || "",
      filename: filePath,
      diff: patch,
      summary: [
        params.state.summary,
        params.state.architectureSummary ? `【项目架构 Memory】\n${params.state.architectureSummary}` : "",
        params.state.agentContextSummary ? `【Agent 检索上下文】\n${params.state.agentContextSummary}` : "",
        Object.keys(params.state.agentPlan || {}).length > 0 ? `【Agent 审查计划】\n${JSON.stringify(params.state.agentPlan, null, 2)}` : "",
      ].filter(Boolean).join("\n\n"),
    });
    const fullPrompt = `=== Bot ===\n${params.bot.name}\n\n=== System Prompt ===\n${params.systemPrompt}\n\n=== User Prompt ===\n${reviewPrompt}`;

    return aiService.reviewCode(reviewPrompt, params.modelConfig, params.systemPrompt)
      .then((aiResponse) => {
        const parsed = aiService.parseStructuredReview(aiResponse, {
          defaultFilePath: filePath,
          maxItems: budget.maxFindings,
        });
        const source = (confidence?: number) => sourceFor(params.botRunId, params.bot.name, botModel, confidence);
        const reviewItems = parsed.commentItems.map((item) => ({
          filePath: item.filePath || filePath,
          lineNumber: item.lineNumber,
          lineRangeEnd: item.lineRangeEnd,
          severity: item.severity,
          content: item.content,
          confidence: item.confidence,
          reviewBotRunId: params.botRunId,
          sourceBotName: params.bot.name,
          sourceBotModel: botModel,
          sourceBots: [source(item.confidence)],
        }));
        const counts = countsFrom(reviewItems);

        aiResponsesByFile[`${params.bot.name}:${filePath}`] = aiResponse;
        reviewPromptsByFile[`${params.bot.name}:${filePath}`] = fullPrompt;
        comments.push(...reviewItems);
        fileResults.push({
          filePath,
          aiResponse,
          prompt: fullPrompt,
          counts,
          criticalItems: reviewItems
            .filter((item) => item.severity === "critical")
            .map((item) => ({
              filePath: item.filePath,
              lineNumber: item.lineNumber,
              lineRangeEnd: item.lineRangeEnd,
              content: item.content,
            })),
          reviewItems,
        });
      })
      .then(() => reviewNext(index + 1));
  };

  return reviewNext(0).then(() => ({
    botRunId: params.botRunId,
    botName: params.bot.name,
    botModel,
    fileResults,
    comments,
    aiResponsesByFile,
    reviewPromptsByFile,
  }));
}

function runBot(state: ReviewState, bot: ReviewBotWithModel): Promise<BotRunResult> {
  const reviewLog = state.reviewLog;
  if (!reviewLog) return Promise.reject(new Error("Review log is required"));

  const modelConfig = toModelConfig(bot);
  if (!modelConfig.isActive) {
    return Promise.reject(new Error(`AI model is disabled: ${modelConfig.modelId}`));
  }

  const branch = reviewLog.targetBranch || reviewLog.sourceBranch || "default";
  const changedFiles = state.relevantDiffs.map((diff) => diff.new_path);
  const diffs = state.relevantDiffs.map((diff) => ({
    filePath: diff.new_path,
    diff: generatePatch(diff),
  }));
  const systemPrompt = buildSystemPrompt(bot);
  const botModel = `${modelConfig.provider}/${modelConfig.modelId}`;
  const budget = normalizeAgentLoopBudget(bot);

  return prisma.reviewBotRun.upsert({
    where: {
      reviewLogId_reviewBotId: {
        reviewLogId: state.reviewLogId,
        reviewBotId: bot.id,
      },
    },
    update: {
      status: "running",
      error: null,
      summary: null,
      aiModelProvider: modelConfig.provider,
      aiModelId: modelConfig.modelId,
      aiModelName: botModel,
      promptSnapshot: bot.prompt || null,
      promptMode: bot.promptMode,
      startedAt: new Date(),
      completedAt: null,
    },
    create: {
      reviewLogId: state.reviewLogId,
      reviewBotId: bot.id,
      status: "running",
      aiModelProvider: modelConfig.provider,
      aiModelId: modelConfig.modelId,
      aiModelName: botModel,
      promptSnapshot: bot.prompt || null,
      promptMode: bot.promptMode,
    },
  }).then((botRun) => {
    return reviewAgentLoopService.run({
      reviewLogId: state.reviewLogId,
      reviewBotRunId: botRun.id,
      repositoryId: reviewLog.repositoryId,
      branch,
      commitSha: reviewLog.commitSha,
      title: reviewLog.title,
      description: reviewLog.description,
      changedFiles,
      diffs,
      modelConfig,
      memorySnapshotId: state.memorySnapshotId,
      existingFindings: [],
      budget,
    }).then((agentResult) => {
      const agentComments = agentResult.agentFindings.map((item) => ({
        ...item,
        reviewBotRunId: botRun.id,
        sourceBotName: bot.name,
        sourceBotModel: botModel,
        sourceBots: [sourceFor(botRun.id, bot.name, botModel, item.confidence)],
      }));

      return runFileReviews({
        state: {
          ...state,
          agentTraceId: agentResult.traceId,
          agentPlan: agentResult.finalPlan as Record<string, unknown>,
          agentContextSummary: agentResult.context.summary,
          architectureSummary: agentResult.context.architectureSummary,
        },
        bot,
        botRunId: botRun.id,
        modelConfig,
        systemPrompt,
        existingFindings: agentComments,
      }).then((fileResult) => {
        const comments = mergeComments([...agentComments, ...fileResult.comments], budget.maxFindings);
        const counts = countsFrom(comments);
        return prisma.reviewBotRun.update({
          where: { id: botRun.id },
          data: {
            status: "completed",
            summary: [
              agentResult.critic.reason || agentResult.finalPlan.reviewStrategy || "completed",
              `findings=${comments.length}`,
              `critical=${counts.critical}`,
              `normal=${counts.normal}`,
              `suggestion=${counts.suggestion}`,
            ].join("; "),
            completedAt: new Date(),
          },
        }).then(() => ({
          ...fileResult,
          comments,
          aiResponsesByFile: fileResult.aiResponsesByFile,
          reviewPromptsByFile: fileResult.reviewPromptsByFile,
          summary: agentResult.critic.reason,
        }));
      });
    }).catch((error) => {
      return prisma.reviewBotRun.update({
        where: { id: botRun.id },
        data: {
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown bot run error",
          completedAt: new Date(),
        },
      }).then(() => Promise.reject(error));
    });
  });
}

export function runReviewBotsNode(state: ReviewState): Promise<Partial<ReviewState>> {
  const reviewLog = state.reviewLog;
  if (!reviewLog) {
    return Promise.reject(new Error("Review log is required before running review bots"));
  }

  return prisma.repositoryReviewBot.findMany({
    where: {
      repositoryId: reviewLog.repositoryId,
      isActive: true,
      aiModel: { isActive: true },
    },
    include: { aiModel: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  }).then((bots) => {
    if (bots.length === 0) {
      throw new Error("No active review bots configured");
    }

    return Promise.allSettled(bots.map((bot) => runBot(state, bot)))
      .then((results) => ({ bots, results }));
  }).then(({ bots, results }) => {
    const successful = results
      .filter((result): result is PromiseFulfilledResult<BotRunResult> => result.status === "fulfilled")
      .map((result) => result.value);

    if (successful.length === 0) {
      const errors = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
      throw new Error(`All review bots failed: ${errors.join("; ")}`);
    }

    const maxFindings = totalFindingsBudget(bots);
    const mergedComments = mergeComments(successful.flatMap((result) => result.comments), maxFindings);
    return {
      fileResults: successful.flatMap((result) => result.fileResults),
      reviewComments: mergedComments,
      criticalComments: mergedComments.filter((item) => item.severity === "critical"),
      aiResponsesByFile: successful.reduce<Record<string, string>>((acc, result) => ({
        ...acc,
        ...result.aiResponsesByFile,
      }), {}),
      reviewPromptsByFile: successful.reduce<Record<string, string>>((acc, result) => ({
        ...acc,
        ...result.reviewPromptsByFile,
      }), {}),
    };
  });
}
