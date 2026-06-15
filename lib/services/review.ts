/**
 * 代码审查服务模块
 *
 * 核心审查逻辑，协调 GitLab 和 Pi Runtime 完成：
 * - 获取 MR/Commit 的代码变更
 * - 调用 Pi + Bubblewrap Runtime 进行代码审查
 * - 解析审查结果并发布评论
 */

import { prisma } from "@/lib/prisma";
import { createGitLabService } from "./gitlab";
import {
  publishReviewTerminalFailureNotification,
} from "@/lib/review/steps/publish-comment";
import { createInitialReviewState, type ReviewState } from "@/lib/review/types";
import { isReviewCancelledStatus, ReviewCancelledError } from "@/lib/services/review-cancellation";
import { REVIEW_AGENT_STAGES, runReviewAgentStage } from "@/lib/review/review-agent-pipeline";
import { reviewWorkflowRecorder } from "@/lib/services/review-workflow-recorder";
import { createLogger, logError } from "@/lib/logger";

const log = createLogger("ReviewService");

/**
 * 代码审查服务类
 */
export class ReviewService {
  /**
   * 执行代码审查
   */
  performReview(reviewLogId: string) {
    log.info(`🔍 [ReviewService] Starting review for log: ${reviewLogId}`);

    return prisma.reviewLog.findUnique({
      where: { id: reviewLogId },
      include: {
        repository: {
          include: {
            gitLabAccount: true,
          },
        },
      },
    }).then((reviewLog) => {
      if (!reviewLog) {
        log.error(`❌ [ReviewService] Review log not found: ${reviewLogId}`);
        throw new Error("Review log not found");
      }

      const gitlabService = createGitLabService(
        reviewLog.repository.gitLabAccount.url,
        reviewLog.repository.gitLabAccount.accessToken,
      );

      const initialState = createInitialReviewState({
        reviewLogId,
        gitlabService,
        reviewLog,
      });

      if (isReviewCancelledStatus(reviewLog.status)) {
        log.info(`🛑 [ReviewService] Review already cancelled: ${reviewLogId}`);
        return publishReviewTerminalFailureNotification(initialState, "cancelled", new ReviewCancelledError(reviewLogId))
          .catch((notifyError) => logError(log, notifyError, "Failed to publish already-cancelled review notification"))
          .then(() => ({
            success: false,
            totalComments: 0,
            criticalIssues: 0,
            normalIssues: 0,
            suggestions: 0,
          }));
      }

      log.info(`🚀 [ReviewService] Running review steps`);

      return REVIEW_AGENT_STAGES.reduce((chain, stage) => (
        chain.then((state) => runReviewAgentStage(state, stage))
      ), Promise.resolve(initialState)).then((result) => {
        return reviewWorkflowRecorder.upsertNode({
          reviewLogId: result.reviewLogId,
          nodeKey: "finish:completed",
          kind: "finish",
          status: "success",
          title: "审查完成",
          summary: `共 ${result.statistics.total} 条问题`,
          detail: "动态审查流程已完成",
          sequence: 9000,
          metrics: result.statistics,
        }).then(() => {
          log.info(`✅ [ReviewService] Review completed successfully`);
          return {
            success: true,
            totalComments: result.statistics.total,
            criticalIssues: result.statistics.critical,
            normalIssues: result.statistics.normal,
            suggestions: result.statistics.suggestion,
          };
        });
      }).catch((error) => this.handleReviewFailure(reviewLogId, initialState, error));
    });
  }

  private handleReviewFailure(reviewLogId: string, state: ReviewState, error: unknown) {
    if (error instanceof ReviewCancelledError) {
      log.info(`🛑 [ReviewService] Review cancelled: ${reviewLogId}`);
      return reviewWorkflowRecorder.cancelRunningNodes(reviewLogId)
        .catch((cancelError) => logError(log, cancelError, "Failed to cancel workflow nodes"))
        .then(() => publishReviewTerminalFailureNotification(state, "cancelled", error))
        .catch((notifyError) => logError(log, notifyError, "Failed to publish cancelled review notification"))
        .then(() => ({
          success: false,
          totalComments: 0,
          criticalIssues: 0,
          normalIssues: 0,
          suggestions: 0,
        }));
    }

    logError(log, error, "Review failed");
    return reviewWorkflowRecorder.upsertNode({
      reviewLogId,
      nodeKey: "finish:failed",
      kind: "finish",
      status: "failed",
      title: "审查失败",
      summary: error instanceof Error ? error.message : "Unknown error",
      detail: error instanceof Error ? error.stack || error.message : "Unknown error",
      sequence: 9000,
    }).catch((workflowError) => {
      logError(log, workflowError, "Failed to write failed workflow node");
    }).then(() => prisma.reviewLog.updateMany({
      where: { id: reviewLogId, status: { not: "cancelled" } },
      data: {
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      },
    })).catch((updateError) => {
      logError(log, updateError, "Failed to mark review log failed");
    }).then(() => publishReviewTerminalFailureNotification(state, "failed", error))
      .catch((notifyError) => logError(log, notifyError, "Failed to publish failed review notification"))
      .then(() => Promise.reject(error));
  }
}

export const reviewService = new ReviewService();
