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
import { reviewWorkflowRecorder, type ReviewWorkflowNodeKind } from "@/lib/services/review-workflow-recorder";
import { createLogger, logError } from "@/lib/logger";

const log = createLogger("ReviewService");

function mergeState(state: ReviewState, patch: Partial<ReviewState>): ReviewState {
  return { ...state, ...patch };
}

type ReviewStepWorkflow = {
  nodeKey: string;
  kind: ReviewWorkflowNodeKind;
  title: string;
  sequence: number;
};

function summarizePatch(step: string, patch: Partial<ReviewState>): { summary?: string; metrics?: unknown } {
  if (step === "fetch_diff") {
    return {
      summary: `可审查文件 ${patch.relevantDiffs?.length || 0} 个`,
      metrics: {
        totalDiffs: patch.diffs?.length || 0,
        relevantDiffs: patch.relevantDiffs?.length || 0,
        reviewScope: patch.reviewScope,
      },
    };
  }
  if (step === "refresh_memory") {
    return {
      summary: patch.memorySnapshotId ? "记忆快照已刷新" : "未生成记忆快照",
      metrics: {
        memorySnapshotId: patch.memorySnapshotId,
        architectureSummaryLength: patch.architectureSummary?.length || 0,
      },
    };
  }
  if (step === "generate_summary") {
    return {
      summary: patch.summary ? patch.summary.slice(0, 120) : "摘要为空",
      metrics: { summaryLength: patch.summary?.length || 0 },
    };
  }
  if (step === "run_agents") {
    return {
      summary: `发现 ${patch.reviewComments?.length || 0} 条候选问题`,
      metrics: {
        comments: patch.reviewComments?.length || 0,
        fileResults: patch.fileResults?.length || 0,
      },
    };
  }
  if (step === "aggregate") {
    return {
      summary: `严重 ${patch.statistics?.critical || 0} / 一般 ${patch.statistics?.normal || 0} / 建议 ${patch.statistics?.suggestion || 0}`,
      metrics: patch.statistics || {},
    };
  }
  if (step === "publish") {
    return {
      summary: patch.error ? "发布失败" : "GitLab 总评已发布",
      metrics: {
        completed: patch.completed,
        error: patch.error,
      },
    };
  }
  return {};
}

/**
 * 代码审查服务类
 */
export class ReviewService {
  private runStep(
    state: ReviewState,
    workflow: ReviewStepWorkflow,
    execute: (state: ReviewState) => Promise<Partial<ReviewState>>,
  ): Promise<Partial<ReviewState>> {
    return reviewWorkflowRecorder.startNode({
      reviewLogId: state.reviewLogId,
      nodeKey: workflow.nodeKey,
      kind: workflow.kind,
      status: "running",
      title: workflow.title,
      sequence: workflow.sequence,
    }).then(() => {
      return execute(state);
    }).then((patch) => {
      const summary = summarizePatch(workflow.nodeKey, patch);
      return reviewWorkflowRecorder.completeNode({
        reviewLogId: state.reviewLogId,
        nodeKey: workflow.nodeKey,
        kind: workflow.kind,
        title: workflow.title,
        status: patch.error ? "failed" : "success",
        summary: summary.summary,
        detail: patch.error || null,
        sequence: workflow.sequence,
        metrics: summary.metrics,
      }).then(() => patch);
    }).catch((error) => {
      return reviewWorkflowRecorder.failNode({
        reviewLogId: state.reviewLogId,
        nodeKey: workflow.nodeKey,
        kind: workflow.kind,
        title: workflow.title,
        summary: "步骤执行失败",
        detail: error instanceof Error ? error.message : "Unknown error",
        sequence: workflow.sequence,
      }).then(() => Promise.reject(error));
    });
  }

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

      state = mergeState(state, await this.runStep(state, {
        nodeKey: "fetch_diff",
        kind: "diff",
        title: "获取 Diff",
        sequence: 100,
      }, fetchDiffStep));

      if (!state.error) {
        await assertStateReviewNotCancelled(state);
        state = mergeState(state, await this.runStep(state, {
          nodeKey: "refresh_memory",
          kind: "memory",
          title: "刷新 Memory / Code Graph",
          sequence: 200,
        }, refreshMemoryStep));
      }

      if (!state.error) {
        await assertStateReviewNotCancelled(state);
        state = mergeState(state, await this.runStep(state, {
          nodeKey: "generate_summary",
          kind: "summary",
          title: "生成变更摘要",
          sequence: 300,
        }, generateSummaryStep));
      }

      if (!state.error && state.relevantDiffs.length > 0) {
        await assertStateReviewNotCancelled(state);
        state = mergeState(state, await this.runStep(state, {
          nodeKey: "run_agents",
          kind: "agent",
          title: "运行 Review Agent",
          sequence: 400,
        }, runReviewBotsStep));
      }

      await assertStateReviewNotCancelled(state);
      state = mergeState(state, await this.runStep(state, {
        nodeKey: "aggregate",
        kind: "aggregate",
        title: "聚合去重",
        sequence: 700,
      }, aggregateResultsStep));

      await assertStateReviewNotCancelled(state);
      const result = mergeState(state, await this.runStep(state, {
        nodeKey: "publish",
        kind: "publish",
        title: "发布 GitLab 评论",
        sequence: 800,
      }, publishCommentStep));
      
      if (result.error) {
        throw new Error(result.error);
      }

      await reviewWorkflowRecorder.upsertNode({
        reviewLogId: state.reviewLogId,
        nodeKey: "finish:completed",
        kind: "finish",
        status: "success",
        title: "审查完成",
        summary: `共 ${result.statistics.total} 条问题`,
        detail: "动态审查流程已完成",
        sequence: 9000,
        metrics: result.statistics,
      });

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
        await reviewWorkflowRecorder.cancelRunningNodes(reviewLogId)
          .catch((cancelError) => logError(log, cancelError, "Failed to cancel workflow nodes"));
        return {
          success: false,
          totalComments: 0,
          criticalIssues: 0,
          normalIssues: 0,
          suggestions: 0,
        };
      }

      logError(log, error, "Review failed");
      await reviewWorkflowRecorder.upsertNode({
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
      });
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
