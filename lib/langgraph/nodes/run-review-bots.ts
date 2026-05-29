/**
 * @file run-review-bots.ts
 * @description 先执行主审查 Agent，再由主 Agent 决定是否调用辅助 Agent
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { reviewAgentLoopService } from "@/lib/services/review-agent-loop";
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

type BotRunSettledResult = PromiseSettledResult<BotRunResult>;

function isFulfilledBotRun(result: BotRunSettledResult): result is PromiseFulfilledResult<BotRunResult> {
  return result.status === "fulfilled";
}

function isRejectedBotRun(result: BotRunSettledResult): result is PromiseRejectedResult {
  return result.status === "rejected";
}

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

function shouldRunAdditionalAgents(primaryResult: BotRunResult, assistantCount: number): boolean {
  if (assistantCount <= 0) return false;
  const plan = primaryResult.finalPlan || {};
  return plan.shouldUseAdditionalAgents === true;
}

function additionalAgentReason(primaryResult: BotRunResult): string {
  const plan = primaryResult.finalPlan || {};
  if (typeof plan.additionalAgentReason === "string" && plan.additionalAgentReason.trim()) {
    return plan.additionalAgentReason.trim();
  }
  if (plan.shouldUseAdditionalAgents === true) {
    return "主审查 Agent 判断需要调用辅助 Agent 复核。";
  }
  return "主审查 Agent 判断当前审查可由单 Agent 完成。";
}

function runBot(state: ReviewState, bot: ReviewBotWithModel): Promise<BotRunResult> {
  const reviewLog = state.reviewLog;
  if (!reviewLog) return Promise.reject(new Error("Review log is required"));

  const modelConfig = toModelConfig(bot);
  if (!modelConfig.isActive) {
    return Promise.reject(new Error(`AI model is disabled: ${modelConfig.modelId}`));
  }

  const branch = reviewLog.sourceBranch || reviewLog.targetBranch || "default";
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

    const [primaryBot, ...assistantBots] = bots;
    return runBot(state, primaryBot)
      .then((primaryResult) => {
        if (!shouldRunAdditionalAgents(primaryResult, assistantBots.length)) {
          console.log(`🤖 [ReviewBots] Additional agents skipped: ${additionalAgentReason(primaryResult)}`);
          return {
            bots,
            results: [{ status: "fulfilled", value: primaryResult } satisfies PromiseFulfilledResult<BotRunResult>],
          };
        }

        console.log(`🤖 [ReviewBots] Primary agent requested additional agents: ${additionalAgentReason(primaryResult)}`);
        return Promise.allSettled(assistantBots.map((bot) => runBot(state, bot)))
          .then((assistantResults) => ({
            bots,
            results: [
              { status: "fulfilled", value: primaryResult } satisfies PromiseFulfilledResult<BotRunResult>,
              ...assistantResults,
            ],
          }));
      })
      .catch((primaryError) => ({
        bots,
        results: [{ status: "rejected", reason: primaryError } satisfies PromiseRejectedResult],
      }));
  }).then(({ bots, results }: { bots: ReviewBotWithModel[]; results: BotRunSettledResult[] }) => {
    const successful = results
      .filter(isFulfilledBotRun)
      .map((result) => result.value);

    if (successful.length === 0) {
      const errors = results
        .filter(isRejectedBotRun)
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
