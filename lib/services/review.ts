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
import { createReviewGraph } from "@/lib/langgraph";
import type { ReviewState } from "@/lib/langgraph/types";

/**
 * 代码审查服务类
 */
export class ReviewService {
  /**
   * 执行代码审查
   */
  async performReview(reviewLogId: string) {
    console.log(`🔍 [ReviewService] Starting review for log: ${reviewLogId}`);

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
      console.error(`❌ [ReviewService] Review log not found: ${reviewLogId}`);
      throw new Error("Review log not found");
    }

    // 2. 初始化 GitLab 服务
    const gitlabService = createGitLabService(
      reviewLog.repository.gitLabAccount.url,
      reviewLog.repository.gitLabAccount.accessToken,
    );

    // 3. 初始化 LangGraph 状态
    const initialState: Partial<ReviewState> = {
      reviewLogId,
      gitlabService,
    };

    // 4. 运行工作流
    try {
      const graph = createReviewGraph();

      console.log(`🚀 [ReviewService] Invoking LangGraph workflow`);
      const result = await graph.invoke(initialState, {
        recursionLimit: 100,
      });
      
      if (result.error) {
        throw new Error(result.error);
      }

      console.log(`✅ [ReviewService] Workflow completed successfully`);
      return {
        success: true,
        totalComments: result.statistics.total,
        criticalIssues: result.statistics.critical,
        normalIssues: result.statistics.normal,
        suggestions: result.statistics.suggestion,
      };

    } catch (error) {
      console.error("Review failed:", error);
      await prisma.reviewLog.update({
        where: { id: reviewLogId },
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
