/**
 * @file run-pi-runtime.ts
 * @description 使用 Pi + OpenSandbox 执行审查
 */

import { prisma } from "@/lib/prisma";
import { validateReviewFindings } from "@/lib/review/finding-validation";
import { buildFindingKey } from "@/lib/review/utils";
import { buildPiReviewInput, runPiReview, toPiFileReviewResult, type PiReviewResult } from "@/lib/services/pi-review-runtime";
import { readPiRuntimeConfig } from "@/lib/services/pi-runtime-config";
import { assertReviewNotCancelled, ReviewCancelledError } from "@/lib/services/review-cancellation";
import { reviewWorkflowRecorder } from "@/lib/services/review-workflow-recorder";
import type { ReviewComment, ReviewCommentSource } from "@/lib/types";
import type { ReviewState } from "../types";

type PiProfile = {
  id: string;
  name: string;
  prompt: string | null;
  promptMode: string;
  maxFindings: number;
  aiModel: {
    provider: string;
    modelId: string;
    apiKey: string;
    apiEndpoint: string | null;
    isActive: boolean;
  };
};

function sourceFor(piRunId: string, profileName: string, model: string, confidence?: number): ReviewCommentSource {
  return { piReviewRunId: piRunId, profileName, model, confidence };
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
        sourceProfiles: comment.sourceProfiles || [],
      });
      continue;
    }

    const sources = [...(existing.sourceProfiles || []), ...(comment.sourceProfiles || [])];
    const uniqueSources = Array.from(
      sources.reduce((sourceMap, source) => {
        const current = sourceMap.get(source.piReviewRunId);
        if (!current || (source.confidence ?? 0) > (current.confidence ?? 0)) {
          sourceMap.set(source.piReviewRunId, source);
        }
        return sourceMap;
      }, new Map<string, ReviewCommentSource>()).values(),
    );

    map.set(key, {
      ...existing,
      confidence: Math.max(existing.confidence ?? 0, comment.confidence ?? 0),
      sourceProfiles: uniqueSources,
      sourceProfileName: uniqueSources.map((source) => source.profileName).join("、"),
      sourceProfileModel: uniqueSources.map((source) => source.model).join("、"),
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

function runPiProfile(state: ReviewState, profile: PiProfile): Promise<{
  comments: ReviewComment[];
  rawResponse: string;
  summary: string;
}> {
  const reviewLog = state.reviewLog;
  if (!reviewLog) return Promise.reject(new Error("Review log is required"));

  const runtimeConfig = readPiRuntimeConfig();
  const piInput = buildPiReviewInput(state);
  const profileModel = `${profile.aiModel.provider}/${profile.aiModel.modelId}`;

  return prisma.piReviewRun.upsert({
    where: {
      reviewLogId_piProfileId: {
        reviewLogId: state.reviewLogId,
        piProfileId: profile.id,
      },
    },
    update: {
      status: "running",
      error: null,
      summary: null,
      modelProvider: profile.aiModel.provider,
      modelId: profile.aiModel.modelId,
      modelName: profileModel,
      promptSnapshot: profile.prompt,
      promptMode: profile.promptMode,
      startedAt: new Date(),
      completedAt: null,
    },
    create: {
      reviewLogId: state.reviewLogId,
      piProfileId: profile.id,
      status: "running",
      modelProvider: profile.aiModel.provider,
      modelId: profile.aiModel.modelId,
      modelName: profileModel,
      promptSnapshot: profile.prompt,
      promptMode: profile.promptMode,
    },
  }).then((piRun) => {
    const markFailed = (error: unknown): Promise<never> => {
      if (error instanceof ReviewCancelledError) {
        return Promise.reject(error);
      }

      return assertReviewNotCancelled(state.reviewLogId)
        .catch((cancelError) => {
          if (cancelError instanceof ReviewCancelledError) {
            return Promise.reject(cancelError);
          }
          return Promise.reject(error);
        })
        .then(() => prisma.piReviewRun.updateMany({
          where: {
            id: piRun.id,
            status: "running",
          },
          data: {
            status: "failed",
            error: error instanceof Error ? error.message : "Unknown Pi review error",
            completedAt: new Date(),
          },
        }))
        .then((updateResult) => {
          if (updateResult.count === 0) {
            return assertReviewNotCancelled(state.reviewLogId).then(() => Promise.reject(error));
          }
        })
        .then(() => reviewWorkflowRecorder.failNode({
          reviewLogId: state.reviewLogId,
          piReviewRunId: piRun.id,
          nodeKey: `pi:${piRun.id}`,
          kind: "runtime",
          title: `Pi Review：${profile.name}`,
          summary: "Pi 执行失败",
          detail: error instanceof Error ? error.message : "Unknown Pi review error",
          sequence: 410,
        }))
        .then(() => Promise.reject(error));
    };

    return reviewWorkflowRecorder.startNode({
      reviewLogId: state.reviewLogId,
      piReviewRunId: piRun.id,
      nodeKey: `pi:${piRun.id}`,
      parentNodeKey: "run_pi_runtime",
      kind: "runtime",
      title: `Pi Review：${profile.name}`,
      summary: profileModel,
      detail: profile.prompt || null,
      sequence: 410,
      metrics: {
        openSandboxDomain: runtimeConfig.openSandboxDomain,
        openSandboxProtocol: runtimeConfig.openSandboxProtocol,
        piSandboxImage: runtimeConfig.piSandboxImage,
        piSandboxTimeoutSeconds: runtimeConfig.piSandboxTimeoutSeconds,
        repositoryId: piInput.repositoryId,
        changedFiles: piInput.changedFiles.length,
      },
    }).then(() => {
      return runPiReview({
        input: piInput,
        gitLabAccessToken: reviewLog.repository.gitLabAccount.accessToken,
        modelConfig: {
          provider: profile.aiModel.provider,
          modelId: profile.aiModel.modelId,
          apiKey: profile.aiModel.apiKey,
          apiEndpoint: profile.aiModel.apiEndpoint,
        },
        profilePrompt: profile.prompt,
        profilePromptMode: profile.promptMode,
      });
    }).then((piResult) => {
      const validatedFindings = validateReviewFindings(piResult.comments, state.relevantDiffs);
      const comments = mergeComments(validatedFindings.map((comment) => ({
        ...comment,
        piReviewRunId: piRun.id,
        sourceProfileName: profile.name,
        sourceProfileModel: profileModel,
        sourceProfiles: [sourceFor(piRun.id, profile.name, profileModel, comment.confidence)],
      })), profile.maxFindings);
      const counts = countsFrom(comments);

      return assertReviewNotCancelled(state.reviewLogId).then(() => prisma.piReviewRun.updateMany({
        where: {
          id: piRun.id,
          status: "running",
        },
        data: {
          status: "completed",
          summary: [
            piResult.summary || "Pi review completed",
            `findings=${comments.length}`,
            `critical=${counts.critical}`,
            `normal=${counts.normal}`,
            `suggestion=${counts.suggestion}`,
          ].join("; "),
          completedAt: new Date(),
        },
      })).then((updateResult) => {
        if (updateResult.count === 0) {
          return assertReviewNotCancelled(state.reviewLogId).then(() => {
            throw new Error("Pi review run is no longer running");
          });
        }
      }).then(() => reviewWorkflowRecorder.completeNode({
        reviewLogId: state.reviewLogId,
        piReviewRunId: piRun.id,
        nodeKey: `pi:${piRun.id}`,
        kind: "runtime",
        title: `Pi Review：${profile.name}`,
        summary: `新增 ${comments.length} 条问题`,
        detail: piResult.summary || null,
        sequence: 410,
        metrics: counts,
      })).then(() => ({
        comments,
        rawResponse: piResult.rawResponse,
        summary: piResult.summary,
      }));
    }).catch(markFailed);
  });
}

export function runPiRuntimeStep(state: ReviewState): Promise<Partial<ReviewState>> {
  const reviewLog = state.reviewLog;
  if (!reviewLog) {
    return Promise.reject(new Error("Review log is required before running Pi review"));
  }

  return prisma.repositoryPiProfile.findMany({
    where: {
      repositoryId: reviewLog.repositoryId,
      isActive: true,
      aiModel: { isActive: true },
    },
    include: {
      aiModel: {
        select: {
          provider: true,
          modelId: true,
          apiKey: true,
          apiEndpoint: true,
          isActive: true,
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  }).then((profiles) => {
    if (profiles.length === 0) {
      throw new Error("No active pi profiles configured");
    }

    const [primaryProfile] = profiles;
    return runPiProfile(state, primaryProfile);
  }).then((result) => {
    const piResult: PiReviewResult = {
      summary: result.summary,
      comments: result.comments,
      rawResponse: result.rawResponse,
    };

    return {
      summary: result.summary || state.summary,
      fileResults: toPiFileReviewResult(piResult),
      reviewComments: result.comments,
      criticalComments: result.comments.filter((item) => item.severity === "critical"),
      piRawOutputsByFile: {
        "pi-review": result.rawResponse,
      },
      piPromptsByFile: {
        "pi-review": JSON.stringify(buildPiReviewInput(state)),
      },
    };
  });
}
