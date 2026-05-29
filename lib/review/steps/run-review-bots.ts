/**
 * @file run-review-bots.ts
 * @description 启动主审查 Agent，辅助 Agent 作为主 loop 的工具暴露
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { reviewAgentLoopService, type AdditionalReviewAgent } from "@/lib/services/review-agent-loop";
import { normalizeAgentLoopBudget, totalFindingsBudget } from "@/lib/services/review-budget";
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
  finalPlan?: Record<string, unknown>;
};

function generatePatch(diff: GitLabDiff): string {
  return `--- a/${diff.old_path}
+++ b/${diff.new_path}
${diff.diff}`;
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

function toAdditionalAgent(bot: ReviewBotWithModel): AdditionalReviewAgent {
  return {
    id: bot.id,
    name: bot.name,
    description: bot.description,
    prompt: bot.prompt,
    promptMode: bot.promptMode,
    modelConfig: toModelConfig(bot),
    budget: normalizeAgentLoopBudget(bot),
  };
}

function runBot(state: ReviewState, bot: ReviewBotWithModel, availableAdditionalAgents: AdditionalReviewAgent[]): Promise<BotRunResult> {
  const reviewLog = state.reviewLog;
  if (!reviewLog) return Promise.reject(new Error("Review log is required"));

  const modelConfig = toModelConfig(bot);
  if (!modelConfig.isActive) {
    return Promise.reject(new Error(`AI model is disabled: ${modelConfig.modelId}`));
  }

  const branch = reviewLog.sourceBranch || "default";
  const changedFiles = state.relevantDiffs.map((diff) => diff.new_path);
  const diffs = state.relevantDiffs.map((diff) => ({
    filePath: diff.new_path,
    diff: generatePatch(diff),
  }));
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
      botName: bot.name,
      botPrompt: bot.prompt,
      botPromptMode: bot.promptMode,
      availableAdditionalAgents,
    }).then((agentResult) => {
      const comments = mergeComments(agentResult.agentFindings.map((item) => ({
        ...item,
        reviewBotRunId: botRun.id,
        sourceBotName: bot.name,
        sourceBotModel: botModel,
        sourceBots: [sourceFor(botRun.id, bot.name, botModel, item.confidence)],
      })), budget.maxFindings);
      const counts = countsFrom(comments);
      const traceKey = `${bot.name}:agent-loop`;
      const fileResults: FileReviewResult[] = comments.length > 0
        ? [{
          filePath: "Agent Loop",
          aiResponse: JSON.stringify({
            traceId: agentResult.traceId,
            critic: agentResult.critic,
            memoryUpdates: agentResult.memoryUpdates,
          }),
          prompt: JSON.stringify(agentResult.finalPlan),
          counts,
          criticalItems: comments
            .filter((item) => item.severity === "critical")
            .map((item) => ({
              filePath: item.filePath,
              lineNumber: item.lineNumber,
              lineRangeEnd: item.lineRangeEnd,
              content: item.content,
            })),
          reviewItems: comments,
        }]
        : [];

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
        botRunId: botRun.id,
        botName: bot.name,
        botModel,
        fileResults,
        comments,
        aiResponsesByFile: {
          [traceKey]: JSON.stringify({
            traceId: agentResult.traceId,
            critic: agentResult.critic,
            contextSummary: agentResult.context.summary,
          }),
        },
        reviewPromptsByFile: {
          [traceKey]: JSON.stringify(agentResult.finalPlan),
        },
        summary: agentResult.critic.reason,
        finalPlan: agentResult.finalPlan as Record<string, unknown>,
      }));
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

export function runReviewBotsStep(state: ReviewState): Promise<Partial<ReviewState>> {
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

    const [primaryBot, ...assistantBots] = bots;
    const availableAdditionalAgents = assistantBots.map(toAdditionalAgent);
    return runBot(state, primaryBot, availableAdditionalAgents)
      .then((primaryResult) => ({ bots, successful: [primaryResult] }));
  }).then(({ bots, successful }) => {

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
