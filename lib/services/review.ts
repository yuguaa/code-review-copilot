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
import { aiService } from "./ai";
import {
  buildReviewPrompt,
  buildSummaryPrompt,
  SYSTEM_PROMPT,
  OUTPUT_FORMAT,
} from "@/lib/prompts";
import type { AIModelConfig, ReviewComment } from "@/lib/types";

/**
 * 代码审查服务类
 */
export class ReviewService {
  /**
   * 执行代码审查
   */
  async performReview(reviewLogId: string) {
    console.log(`🔍 [ReviewService] Starting review for log: ${reviewLogId}`);

    const reviewLog = await prisma.reviewLog.findUnique({
      where: { id: reviewLogId },
      include: {
        repository: {
          include: {
            gitLabAccount: true,
            defaultAIModel: true,
          },
        },
      },
    });

    if (!reviewLog) {
      console.error(`❌ [ReviewService] Review log not found: ${reviewLogId}`);
      throw new Error("Review log not found");
    }

    console.log(`📋 [ReviewService] Review: ${reviewLog.title}`);
    console.log(
      `📂 [ReviewService] Branch: ${reviewLog.sourceBranch} → ${reviewLog.targetBranch || "N/A"}`,
    );

    try {
      await prisma.reviewLog.update({
        where: { id: reviewLogId },
        data: { status: "pending" },
      });
      console.log(`🔄 [ReviewService] Status updated to: pending`);

      const gitlabService = createGitLabService(
        reviewLog.repository.gitLabAccount.url,
        reviewLog.repository.gitLabAccount.accessToken,
      );

      const isPushEvent = reviewLog.mergeRequestIid === 0;
      let mr: any = null;
      let diffs: any[] = [];

      if (isPushEvent) {
        console.log(
          `📌 [ReviewService] Processing Push event for commit: ${reviewLog.commitSha}`,
        );
        diffs = await gitlabService.getCommitDiff(
          reviewLog.repository.gitLabProjectId,
          reviewLog.commitSha,
        );
      } else {
        mr = await gitlabService.getMergeRequest(
          reviewLog.repository.gitLabProjectId,
          reviewLog.mergeRequestIid,
        );

        const commits = await gitlabService.getMergeRequestCommits(
          reviewLog.repository.gitLabProjectId,
          reviewLog.mergeRequestIid,
        );

        if (!commits || commits.length === 0) {
          throw new Error("No commits found in merge request");
        }

        const latestCommit = commits[0];
        diffs = await gitlabService.getCommitDiff(
          reviewLog.repository.gitLabProjectId,
          latestCommit.id,
        );
      }

      const relevantDiffs = diffs.filter((diff) => !diff.deleted_file);

      console.log(`📁 [ReviewService] Total files changed: ${diffs.length}`);
      console.log(`📁 [ReviewService] Files to review: ${relevantDiffs.length}`);

      await prisma.reviewLog.update({
        where: { id: reviewLogId },
        data: { totalFiles: relevantDiffs.length },
      });

      // 准备 AI 模型配置（优先级：自定义模型 > 仓库默认 > 全局默认）
      const repository = reviewLog.repository;
      const modelConfig: AIModelConfig = {
        id: repository.customProvider
          ? "custom"
          : repository.defaultAIModel?.id || "default",
        name:
          repository.customModelId ||
          repository.defaultAIModel?.modelId ||
          "default",
        provider: (repository.customProvider ||
          repository.defaultAIModel?.provider ||
          "openai") as any,
        modelId:
          repository.customModelId ||
          repository.defaultAIModel?.modelId ||
          "gpt-4o",
        apiKey:
          repository.customApiKey || repository.defaultAIModel?.apiKey || "",
        apiEndpoint:
          repository.customApiEndpoint ||
          repository.defaultAIModel?.apiEndpoint ||
          undefined,
        maxTokens:
          repository.customMaxTokens ||
          repository.defaultAIModel?.maxTokens ||
          undefined,
        temperature:
          repository.customTemperature ||
          repository.defaultAIModel?.temperature ||
          undefined,
        isActive: true,
      };

      console.log(
        `🤖 [ReviewService] Using AI model: ${modelConfig.provider}/${modelConfig.modelId}`,
      );

      // 生成变更总结
      const allDiffsText = diffs.map((d) => d.diff).join("\n");
      const summaryPrompt = buildSummaryPrompt({
        title: mr?.title || reviewLog.title,
        description: mr?.description || reviewLog.description || "",
        diffs: allDiffsText,
      });

      const summary = await aiService.reviewCode(summaryPrompt, modelConfig);

      await prisma.reviewLog.update({
        where: { id: reviewLogId },
        data: { aiSummary: summary },
      });

      // 逐文件进行审查
      let totalComments: ReviewComment[] = [];
      const aiResponsesByFile: Record<string, string> = {};

      for (const diff of relevantDiffs) {
        const filePath = diff.new_path;
        console.log(`📄 [ReviewService] Reviewing file: ${filePath}`);

        const patch = this.generatePatch(diff);

        // 构建系统提示词（支持 extend/replace 模式）
        let systemPrompt = SYSTEM_PROMPT;

        console.log(`🔧 [ReviewService] Repository config:`);
        console.log(
          `   - customPrompt: ${repository.customPrompt ? "已设置" : "未设置"}`,
        );
        console.log(
          `   - customPromptMode: ${(repository as any).customPromptMode || "extend"}`,
        );

        if (repository.customPrompt) {
          const promptMode = (repository as any).customPromptMode || "extend";
          if (promptMode === "replace") {
            systemPrompt = repository.customPrompt + OUTPUT_FORMAT;
            console.log(`📝 [ReviewService] Using REPLACE mode`);
          } else {
            systemPrompt = `${SYSTEM_PROMPT}\n\n【仓库自定义要求】\n${repository.customPrompt}`;
            console.log(`📝 [ReviewService] Using EXTEND mode`);
          }
        }

        const reviewPrompt = buildReviewPrompt({
          title: mr?.title || reviewLog.title,
          description: mr?.description || reviewLog.description || "",
          filename: filePath,
          diff: patch,
          summary: summary,
        });

        const aiResponse = await aiService.reviewCode(
          reviewPrompt,
          modelConfig,
          systemPrompt,
        );

        aiResponsesByFile[filePath] = aiResponse;

        // 调试：打印 AI 响应
        console.log(`\n🤖 [ReviewService] AI Response for ${filePath}:`);
        console.log("┌─────────────────────────────────────────────┐");
        aiResponse.split("\n").forEach((line) => console.log(`│ ${line}`));
        console.log("└─────────────────────────────────────────────┘");

        const comments = aiService.parseReviewComments(aiResponse, filePath);

        // 无评论时使用原始响应
        if (comments.length === 0) {
          comments.push({
            filePath,
            lineNumber: 1,
            severity: "suggestion" as const,
            content: aiResponse.trim(),
          });
        }

        console.log(`💬 [ReviewService] Found ${comments.length} comments in ${filePath}`);
        totalComments.push(...comments);

        await prisma.reviewLog.update({
          where: { id: reviewLogId },
          data: { reviewedFiles: { increment: 1 } },
        });
      }

      // 统计问题
      const criticalIssues = totalComments.filter((c) => c.severity === "critical").length;
      const normalIssues = totalComments.filter((c) => c.severity === "normal").length;
      const suggestions = totalComments.filter((c) => c.severity === "suggestion").length;

      console.log(`📊 [ReviewService] Review complete:`);
      console.log(`   🔴 Critical: ${criticalIssues}`);
      console.log(`   ⚠️ Normal: ${normalIssues}`);
      console.log(`   💡 Suggestions: ${suggestions}`);

      // 保存评论
      for (const comment of totalComments) {
        await prisma.reviewComment.create({
          data: {
            reviewLogId,
            filePath: comment.filePath,
            lineNumber: comment.lineNumber,
            lineRangeEnd: comment.lineRangeEnd,
            severity: comment.severity,
            content: comment.content,
            diffHunk: comment.diffHunk,
          },
        });
      }

      // 更新审查状态
      await prisma.reviewLog.update({
        where: { id: reviewLogId },
        data: {
          status: "completed",
          completedAt: new Date(),
          criticalIssues,
          normalIssues,
          suggestions,
          aiResponse: JSON.stringify(aiResponsesByFile),
        },
      });

      await this.postCommentsToGitLab(reviewLogId, gitlabService);

      return {
        success: true,
        totalComments: totalComments.length,
        criticalIssues,
        normalIssues,
        suggestions,
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

  /**
   * 发布评论到 GitLab MR
   */
  async postCommentsToGitLab(reviewLogId: string, gitlabService: any) {
    const reviewLog = await prisma.reviewLog.findUnique({
      where: { id: reviewLogId },
      include: {
        repository: true,
        comments: {
          where: { isPosted: false },
        },
      },
    });

    if (!reviewLog) {
      throw new Error("Review log not found");
    }

    // Push 事件使用 Commit Comment
    if (reviewLog.mergeRequestIid === 0) {
      console.log(`📝 [ReviewService] Posting comments to commit: ${reviewLog.commitSha}`);
      await this.postCommentsToCommit(reviewLog, gitlabService);
      return;
    }

    const mr = await gitlabService.getMergeRequest(
      reviewLog.repository.gitLabProjectId,
      reviewLog.mergeRequestIid,
    );

    // 发布评论
    for (const comment of reviewLog.comments) {
      try {
        const commentBody = `${comment.content}\n\n---\n<sub>🤖comments generate from code review copolit,written by [yuguaa](https://github.com/yuguaa)</sub>`;

        const position = {
          base_sha: mr.diff_refs.base_sha,
          head_sha: mr.diff_refs.head_sha,
          start_sha: mr.diff_refs.start_sha,
          old_path: comment.filePath,
          new_path: comment.filePath,
          position_type: "text" as const,
          new_line: comment.lineNumber,
        };

        const result = await gitlabService.createMergeRequestComment(
          reviewLog.repository.gitLabProjectId,
          reviewLog.mergeRequestIid,
          commentBody,
          position,
        );

        await prisma.reviewComment.update({
          where: { id: comment.id },
          data: { isPosted: true, gitlabCommentId: result.id?.toString() },
        });

        console.log(`✅ Posted inline comment: ${comment.filePath}:${comment.lineNumber}`);
      } catch (error) {
        console.log(`⚠️ Inline comment failed, trying general comment...`);

        try {
          const commentBody = `${comment.content}\n\n---\n<sub>🤖comments generate from code review copolit,written by [yuguaa](https://github.com/yuguaa)</sub>`;

          const result = await gitlabService.createMergeRequestComment(
            reviewLog.repository.gitLabProjectId,
            reviewLog.mergeRequestIid,
            commentBody,
            undefined,
          );

          await prisma.reviewComment.update({
            where: { id: comment.id },
            data: { isPosted: true, gitlabCommentId: result.id?.toString() },
          });

          console.log(`✅ Posted general comment for: ${comment.filePath}:${comment.lineNumber}`);
        } catch (fallbackError) {
          console.error(`❌ Failed to post comment for ${comment.filePath}:${comment.lineNumber}`);
        }
      }
    }
  }

  /**
   * 发布评论到 GitLab Commit（Push 事件）
   */
  async postCommentsToCommit(reviewLog: any, gitlabService: any) {
    const comments = reviewLog.comments;

    if (!comments || comments.length === 0) {
      console.log(`📭 [ReviewService] No comments to post`);
      return;
    }

    console.log(`📤 [ReviewService] Posting ${comments.length} comments to commit`);

    for (const comment of comments) {
      try {
        const commentBody = `${comment.content}\n\n---\n<sub>🤖comments generate from code review copolit,written by [yuguaa](https://github.com/yuguaa)</sub>`;

        const result = await gitlabService.createCommitComment(
          reviewLog.repository.gitLabProjectId,
          reviewLog.commitSha,
          commentBody,
          {
            path: comment.filePath,
            line: comment.lineNumber,
            line_type: "new",
          },
        );

        await prisma.reviewComment.update({
          where: { id: comment.id },
          data: { isPosted: true, gitlabCommentId: result.id?.toString() },
        });

        console.log(`✅ Posted comment to commit: ${comment.filePath}:${comment.lineNumber}`);
      } catch (error) {
        console.log(`⚠️ Inline commit comment failed, trying general comment...`);

        try {
          const commentBody = `${comment.content}\n\n---\n<sub>🤖comments generate from code review copolit,written by [yuguaa](https://github.com/yuguaa)</sub>`;

          const result = await gitlabService.createCommitComment(
            reviewLog.repository.gitLabProjectId,
            reviewLog.commitSha,
            commentBody,
            undefined,
          );

          await prisma.reviewComment.update({
            where: { id: comment.id },
            data: { isPosted: true, gitlabCommentId: result.id?.toString() },
          });

          console.log(`✅ Posted general comment to commit`);
        } catch (fallbackError) {
          console.error(`❌ Failed to post comment to commit: ${comment.filePath}:${comment.lineNumber}`);
        }
      }
    }
  }

  /** 生成 unified diff 格式 */
  private generatePatch(diff: any): string {
    return `--- a/${diff.old_path}
+++ b/${diff.new_path}
${diff.diff}`;
  }
}

export const reviewService = new ReviewService();
