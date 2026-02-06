/**
 * @file graph.ts
 * @description LangGraph 图结构定义
 */

import { StateGraph } from "@langchain/langgraph";
import { ReviewStateAnnotation } from "./types";
import type { ReviewState } from "./types";
import { fetchDiffNode } from "./nodes/fetch-diff";
import { generateSummaryNode } from "./nodes/generate-summary";
import {
  reviewFileNode,
  shouldContinueReview,
  moveToNextFile,
} from "./nodes/review-file";
import { aggregateResultsNode } from "./nodes/aggregate-results";
import { publishCommentNode } from "./nodes/publish-comment";

/**
 * 检查是否有文件需要审查
 */
function hasFilesToReview(state: ReviewState): "review" | "skip" {
  if (state.relevantDiffs.length === 0) {
    console.log(
      "⏭️ [hasFilesToReview] No files to review, skipping to aggregate",
    );
    return "skip";
  }
  return "review";
}

/**
 * 构建代码审查工作流图
 */
export function createReviewGraph() {
  const workflow = new StateGraph(ReviewStateAnnotation)
    // 添加节点
    .addNode("fetch_diff", fetchDiffNode)
    .addNode("generate_summary", generateSummaryNode)
    .addNode("review_file", reviewFileNode)
    .addNode("next_file", moveToNextFile)
    .addNode("aggregate_results", aggregateResultsNode)
    .addNode("publish_comment", publishCommentNode)

    // 定义边
    .addEdge("__start__", "fetch_diff")
    .addEdge("fetch_diff", "generate_summary")

    // 检查是否有文件需要审查
    .addConditionalEdges("generate_summary", hasFilesToReview, {
      review: "review_file",
      skip: "aggregate_results",
    })

    // 循环逻辑
    .addConditionalEdges("review_file", shouldContinueReview, {
      continue: "next_file",
      aggregate: "aggregate_results",
    })
    .addEdge("next_file", "review_file")

    .addEdge("aggregate_results", "publish_comment")
    .addEdge("publish_comment", "__end__");

  return workflow.compile();
}
