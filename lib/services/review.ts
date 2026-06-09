/**
 * 代码审查服务模块
 *
 * 核心审查逻辑，协调 GitLab 和 AI 服务完成：
 * - 获取 MR/Commit 的代码变更
 * - 调用 AI 进行代码审查
 * - 解析审查结果并发布评论
 */

import { prisma } from "@/lib/prisma";
import { createGitLabService } from "./gitlab";
import { aggregateResultsStep } from "@/lib/review/steps/aggregate-results";
import { fetchDiffStep } from "@/lib/review/steps/fetch-diff";
import { generateSummaryStep } from "@/lib/review/steps/generate-summary";
import { publishCommentStep } from "@/lib/review/steps/publish-comment";
import { refreshMemoryStep } from "@/lib/review/steps/refresh-memory";
import { runReviewBotsStep } from "@/lib/review/steps/run-review-bots";
import { createInitialReviewState, type ReviewState } from "@/lib/review/types";
import { assertStateReviewNotCancelled, isReviewCancelledStatus, ReviewCancelledError } from "@/lib/services/review-cancellation";
import { createLogger, logError } from "@/lib/logger";

const log = createLogger("ReviewService");

function mergeState(state: ReviewState, patch: Partial<ReviewState>): ReviewState {
  return { ...state, ...patch };
}

/**
 * 代码审查服务类
 */
export class ReviewService {
  /**
   * 执行代码审查
   */
  async performReview(reviewLogId: string) {
    log.info(`🔍 [ReviewService] Starting review for log: ${reviewLogId}`);

    // 1. 获取 ReviewLog 以初始化 GitLab 服务
    const reviewLog = await prisma.reviewLog.findUnique({
      where: { id: reviewLogId },
      include: {
        repository: {
          include: {
            gitLabAccount: true,
          },
        },
      },
    });

    if (!reviewLog) {
      log.error(`❌ [ReviewService] Review log not found: ${reviewLogId}`);
      throw new Error("Review log not found");
    }

    if (isReviewCancelledStatus(reviewLog.status)) {
      log.info(`🛑 [ReviewService] Review already cancelled: ${reviewLogId}`);
      return {
        success: false,
        totalComments: 0,
        criticalIssues: 0,
        normalIssues: 0,
        suggestions: 0,
      };
    }

    // 2. 初始化 GitLab 服务
    const gitlabService = createGitLabService(
      reviewLog.repository.gitLabAccount.url,
      reviewLog.repository.gitLabAccount.accessToken,
    );

    // 3. 初始化审查状态
    let state = createInitialReviewState({
      reviewLogId,
      gitlabService,
      reviewLog,
    });

    // 4. 按固定链路执行，下一步由状态直接 if/else 决定。
    try {
      log.info(`🚀 [ReviewService] Running review steps`);

      state = mergeState(state, await fetchDiffStep(state));

      if (!state.error) {
        await assertStateReviewNotCancelled(state);
        state = mergeState(state, await refreshMemoryStep(state));
      }

      if (!state.error) {
        await assertStateReviewNotCancelled(state);
        state = mergeState(state, await generateSummaryStep(state));
      }

      if (!state.error && state.relevantDiffs.length > 0) {
        await assertStateReviewNotCancelled(state);
        state = mergeState(state, await runReviewBotsStep(state));
      }

      await assertStateReviewNotCancelled(state);
      state = mergeState(state, await aggregateResultsStep(state));

      await assertStateReviewNotCancelled(state);
      const result = mergeState(state, await publishCommentStep(state));
      
      if (result.error) {
        throw new Error(result.error);
      }

      log.info(`✅ [ReviewService] Review completed successfully`);
      return {
        success: true,
        totalComments: result.statistics.total,
        criticalIssues: result.statistics.critical,
        normalIssues: result.statistics.normal,
        suggestions: result.statistics.suggestion,
      };

    } catch (error) {
      if (error instanceof ReviewCancelledError) {
        log.info(`🛑 [ReviewService] Review cancelled: ${reviewLogId}`);
        return {
          success: false,
          totalComments: 0,
          criticalIssues: 0,
          normalIssues: 0,
          suggestions: 0,
        };
      }

      logError(log, error, "Review failed");
      await prisma.reviewLog.updateMany({
        where: { id: reviewLogId, status: { not: "cancelled" } },
        data: {
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });
      throw error;
    }
  }
}

export const reviewService = new ReviewService();
