/**
 * @file graph.ts
 * @description 代码审查工作流顺序执行器
 */

import { createInitialReviewState, type ReviewState } from "./types";
import { fetchDiffNode } from "./nodes/fetch-diff";
import { refreshMemoryNode } from "./nodes/refresh-memory";
import { generateSummaryNode } from "./nodes/generate-summary";
import { runReviewBotsNode } from "./nodes/run-review-bots";
import { aggregateResultsNode } from "./nodes/aggregate-results";
import { publishCommentNode } from "./nodes/publish-comment";

/**
 * 检查是否有文件需要审查
 */
function hasFilesToReview(state: ReviewState): boolean {
  if (state.relevantDiffs.length === 0) {
    console.log(
      "⏭️ [hasFilesToReview] No files to review, skipping to aggregate",
    );
    return false;
  }
  return true;
}

function mergeState(state: ReviewState, patch: Partial<ReviewState>): ReviewState {
  return {
    ...state,
    ...patch,
  };
}

/**
 * 创建代码审查工作流。
 *
 * 这里不用 工作流，审查链路是固定有界流程，直接顺序执行更清晰：
 * fetch diff -> refresh memory -> summary -> bots -> aggregate -> publish。
 */
export function createReviewWorkflow() {
  return {
    invoke(input: Partial<ReviewState>): Promise<ReviewState> {
      let state = createInitialReviewState(input);

      return fetchDiffNode(state)
        .then((patch) => {
          state = mergeState(state, patch);
          if (state.error) return state;
          return refreshMemoryNode(state).then((memoryPatch) => {
            state = mergeState(state, memoryPatch);
            return state;
          });
        })
        .then((currentState) => {
          if (currentState.error) return currentState;
          return generateSummaryNode(currentState).then((summaryPatch) => {
            state = mergeState(currentState, summaryPatch);
            return state;
          });
        })
        .then((currentState) => {
          if (currentState.error || !hasFilesToReview(currentState)) return currentState;
          return runReviewBotsNode(currentState).then((botsPatch) => {
            state = mergeState(currentState, botsPatch);
            return state;
          });
        })
        .then((currentState) => {
          return aggregateResultsNode(currentState).then((aggregatePatch) => {
            state = mergeState(currentState, aggregatePatch);
            return state;
          });
        })
        .then((currentState) => {
          return publishCommentNode(currentState).then((publishPatch) => {
            state = mergeState(currentState, publishPatch);
            return state;
          });
        });
    },
  };
}
