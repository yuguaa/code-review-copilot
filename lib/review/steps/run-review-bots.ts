/**
 * @file run-review-bots.ts
 * @description 启动主审查 Agent，辅助 Agent 作为主 loop 的工具暴露
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getReviewFilePath, validateReviewFindings } from "@/lib/review/finding-validation";
import { buildFindingKey, generatePatch, toModelConfig } from "@/lib/review/utils";
import { reviewAgentLoopService, type AdditionalReviewAgent } from "@/lib/services/review-agent-loop";
import { normalizeAgentLoopBudget, totalFindingsBudget } from "@/lib/services/review-budget";
import { reviewWorkflowRecorder } from "@/lib/services/review-workflow-recorder";
import type { ReviewComment, ReviewCommentSource } from "@/lib/types";
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

function sourceFor(botRunId: string, botName: string, botModel: string, confidence?: number): ReviewCommentSource {
  return { reviewBotRunId: botRunId, botName, model: botModel, confidence };
}

function mergeComments(comments: ReviewComment[], maxFindings: number): ReviewComment[] {
  const map = new Map<string, ReviewComment>();

  for (const comment of comments) {
    const key = buildFindingKey(comment);
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
    modelConfig: toModelConfig(bot.aiModel),
    budget: normalizeAgentLoopBudget(bot),
  };
}

function runBot(state: ReviewState, bot: ReviewBotWithModel, availableAdditionalAgents: AdditionalReviewAgent[]): Promise<BotRunResult> {
  const reviewLog = state.reviewLog;
  if (!reviewLog) return Promise.reject(new Error("Review log is required"));

  const modelConfig = toModelConfig(bot.aiModel);
  if (!modelConfig.isActive) {
    return Promise.reject(new Error(`AI model is disabled: ${modelConfig.modelId}`));
  }

  const branch = reviewLog.sourceBranch || "default";
  const changedFiles = state.relevantDiffs.map(getReviewFilePath);
  const diffs = state.relevantDiffs.map((diff) => ({
    filePath: getReviewFilePath(diff),
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
    return reviewWorkflowRecorder.startNode({
      reviewLogId: state.reviewLogId,
      reviewBotRunId: botRun.id,
      nodeKey: `agent:${botRun.id}`,
      parentNodeKey: "run_agents",
      kind: "agent",
      title: `主 Agent：${bot.name}`,
      summary: botModel,
      detail: bot.description || bot.prompt || null,
      sequence: 410,
      metrics: {
        maxIterations: budget.maxIterations,
        maxContextFiles: budget.maxContextFiles,
        maxCallGraphDepth: budget.maxCallGraphDepth,
        maxFindings: budget.maxFindings,
        assistantAgents: availableAdditionalAgents.length,
      },
    }).then(() => reviewAgentLoopService.run({
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
    })).then((agentResult) => {
      const validatedFindings = validateReviewFindings(agentResult.agentFindings, state.relevantDiffs);
      const comments = mergeComments(validatedFindings.map((item) => ({
        ...item,
        reviewBotRunId: item.reviewBotRunId || botRun.id,
        sourceBotName: item.sourceBotName || bot.name,
        sourceBotModel: item.sourceBotModel || botModel,
        sourceBots: item.sourceBots?.length
          ? item.sourceBots
          : [sourceFor(botRun.id, bot.name, botModel, item.confidence)],
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
      }).then(() => reviewWorkflowRecorder.completeNode({
        reviewLogId: state.reviewLogId,
        reviewBotRunId: botRun.id,
        nodeKey: `agent:${botRun.id}`,
        kind: "agent",
        title: `主 Agent：${bot.name}`,
        summary: `新增 ${comments.length} 条问题`,
        detail: agentResult.critic.reason || agentResult.finalPlan.reviewStrategy || null,
        sequence: 410,
        metrics: {
          findings: comments.length,
          critical: counts.critical,
          normal: counts.normal,
          suggestion: counts.suggestion,
        },
      })).then(() => ({
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
      }).then(() => reviewWorkflowRecorder.failNode({
        reviewLogId: state.reviewLogId,
        reviewBotRunId: botRun.id,
        nodeKey: `agent:${botRun.id}`,
        kind: "agent",
        title: `主 Agent：${bot.name}`,
        summary: "主 Agent 执行失败",
        detail: error instanceof Error ? error.message : "Unknown bot run error",
        sequence: 410,
      })).then(() => Promise.reject(error));
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
