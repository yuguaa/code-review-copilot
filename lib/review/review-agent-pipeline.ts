import { aggregateResultsStep } from "@/lib/review/steps/aggregate-results";
import { fetchDiffStep } from "@/lib/review/steps/fetch-diff";
import { generateSummaryStep } from "@/lib/review/steps/generate-summary";
import { publishCommentStep } from "@/lib/review/steps/publish-comment";
import { runPiRuntimeStep } from "@/lib/review/steps/run-pi-runtime";
import type { ReviewState } from "@/lib/review/types";
import { assertStateReviewNotCancelled, ReviewCancelledError } from "@/lib/services/review-cancellation";
import { reviewWorkflowRecorder, type ReviewWorkflowNodeKind } from "@/lib/services/review-workflow-recorder";

export type ReviewAgentStage = {
  nodeKey: string;
  kind: ReviewWorkflowNodeKind;
  title: string;
  sequence: number;
  execute: (state: ReviewState) => Promise<Partial<ReviewState>>;
  shouldRun?: (state: ReviewState) => boolean;
  skippedSummary?: (state: ReviewState) => string;
};

export function mergeReviewState(state: ReviewState, patch: Partial<ReviewState>): ReviewState {
  return { ...state, ...patch };
}

function summarizeStagePatch(stage: ReviewAgentStage, patch: Partial<ReviewState>): { summary?: string; metrics?: unknown } {
  if (stage.nodeKey === "fetch_diff") {
    return {
      summary: `可审查文件 ${patch.relevantDiffs?.length || 0} 个`,
      metrics: {
        totalDiffs: patch.diffs?.length || 0,
        relevantDiffs: patch.relevantDiffs?.length || 0,
        reviewScope: patch.reviewScope,
      },
    };
  }
  if (stage.nodeKey === "generate_summary") {
    return {
      summary: patch.summary ? patch.summary.slice(0, 120) : "摘要为空",
      metrics: { summaryLength: patch.summary?.length || 0 },
    };
  }
  if (stage.nodeKey === "run_pi_runtime") {
    return {
      summary: `发现 ${patch.reviewComments?.length || 0} 条候选问题`,
      metrics: {
        comments: patch.reviewComments?.length || 0,
        fileResults: patch.fileResults?.length || 0,
      },
    };
  }
  if (stage.nodeKey === "aggregate") {
    return {
      summary: `严重 ${patch.statistics?.critical || 0} / 一般 ${patch.statistics?.normal || 0} / 建议 ${patch.statistics?.suggestion || 0}`,
      metrics: patch.statistics || {},
    };
  }
  if (stage.nodeKey === "publish") {
    return {
      summary: "GitLab 总评已发布",
      metrics: {
        completed: patch.completed,
      },
    };
  }
  return {};
}

function patchError(patch: Partial<ReviewState>): Error | null {
  return patch.error ? new Error(patch.error) : null;
}

function markStageSkipped(state: ReviewState, stage: ReviewAgentStage): Promise<ReviewState> {
  return reviewWorkflowRecorder.upsertNode({
    reviewLogId: state.reviewLogId,
    nodeKey: stage.nodeKey,
    kind: stage.kind,
    status: "skipped",
    title: stage.title,
    summary: stage.skippedSummary ? stage.skippedSummary(state) : "无可执行内容",
    sequence: stage.sequence,
  }).then(() => state);
}

export function runReviewAgentStage(state: ReviewState, stage: ReviewAgentStage): Promise<ReviewState> {
  if (stage.shouldRun && !stage.shouldRun(state)) {
    return markStageSkipped(state, stage);
  }

  return assertStateReviewNotCancelled(state)
    .then(() => reviewWorkflowRecorder.startNode({
      reviewLogId: state.reviewLogId,
      nodeKey: stage.nodeKey,
      kind: stage.kind,
      status: "running",
      title: stage.title,
      sequence: stage.sequence,
    }))
    .then(() => stage.execute(state))
    .then((patch) => {
      const error = patchError(patch);
      if (error) return Promise.reject(error);

      const summary = summarizeStagePatch(stage, patch);
      return reviewWorkflowRecorder.completeNode({
        reviewLogId: state.reviewLogId,
        nodeKey: stage.nodeKey,
        kind: stage.kind,
        title: stage.title,
        status: "success",
        summary: summary.summary,
        detail: null,
        sequence: stage.sequence,
        metrics: summary.metrics,
      }).then(() => mergeReviewState(state, patch));
    }).catch((error) => {
      if (error instanceof ReviewCancelledError) {
        return reviewWorkflowRecorder.completeNode({
          reviewLogId: state.reviewLogId,
          nodeKey: stage.nodeKey,
          kind: stage.kind,
          title: stage.title,
          status: "cancelled",
          summary: "步骤已停止",
          detail: error.message,
          sequence: stage.sequence,
        }).then(() => Promise.reject(error));
      }

      return reviewWorkflowRecorder.failNode({
        reviewLogId: state.reviewLogId,
        nodeKey: stage.nodeKey,
        kind: stage.kind,
        title: stage.title,
        summary: "步骤执行失败",
        detail: error instanceof Error ? error.message : "Unknown error",
        sequence: stage.sequence,
      }).then(() => Promise.reject(error));
    });
}

export const REVIEW_AGENT_STAGES: ReviewAgentStage[] = [
  {
    nodeKey: "fetch_diff",
    kind: "diff",
    title: "获取 Diff",
    sequence: 100,
    execute: fetchDiffStep,
  },
  {
    nodeKey: "generate_summary",
    kind: "summary",
    title: "生成变更摘要",
    sequence: 200,
    execute: generateSummaryStep,
  },
  {
    nodeKey: "run_pi_runtime",
    kind: "runtime",
    title: "运行 Pi Runtime",
    sequence: 300,
    execute: runPiRuntimeStep,
    shouldRun: (state) => state.relevantDiffs.length > 0,
    skippedSummary: () => "没有可审查文件，跳过 Pi Runtime",
  },
  {
    nodeKey: "aggregate",
    kind: "aggregate",
    title: "聚合去重",
    sequence: 400,
    execute: aggregateResultsStep,
  },
  {
    nodeKey: "publish",
    kind: "publish",
    title: "发布 GitLab 评论",
    sequence: 500,
    execute: publishCommentStep,
  },
];
