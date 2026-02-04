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
  buildBatchReviewPrompt,
  SYSTEM_PROMPT,
  OUTPUT_FORMAT,
} from "@/lib/prompts";
import type { AIModelConfig, ReviewComment } from "@/lib/types";

type ReviewCommentLike = {
  filePath: string;
  lineNumber: number;
  lineRangeEnd?: number | null;
  severity?: string | null;
  content: string;
};

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

        // 使用 changes API 获取 MR 的所有变更（包含所有 commits 的 diff）
        console.log(`📌 [ReviewService] Fetching all changes for MR !${reviewLog.mergeRequestIid}`);
        diffs = await gitlabService.getMergeRequestChanges(
          reviewLog.repository.gitLabProjectId,
          reviewLog.mergeRequestIid,
        );

        if (!diffs || diffs.length === 0) {
          console.log(`⏭️ [ReviewService] No changes found in MR`);
          throw new Error("No changes found in merge request");
        }

        console.log(`📌 [ReviewService] Found ${diffs.length} files with changes in MR`);
      }

      const relevantDiffs = diffs.filter((diff) => !diff.deleted_file);

      console.log(`📁 [ReviewService] Total files changed: ${relevantDiffs.length}`);

      await prisma.reviewLog.update({
        where: { id: reviewLogId },
        data: {
          totalFiles: relevantDiffs.length,
          reviewedFiles: 0,
        },
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

      // 根据文件数量选择审查策略
      const BATCH_THRESHOLD = 20; // 超过20个文件时使用批量审查
      const useBatchReview = relevantDiffs.length > BATCH_THRESHOLD;

      if (useBatchReview) {
        console.log(`📊 [ReviewService] Using batch review mode for ${relevantDiffs.length} files`);

        // 准备批量审查的文件数据
        const filesForBatchReview = relevantDiffs.map((diff) => ({
          path: diff.new_path,
          diff: this.generatePatch(diff),
        }));

        // 构建批量审查提示词
        let systemPrompt = SYSTEM_PROMPT;
        if (repository.customPrompt) {
          const promptMode = (repository as any).customPromptMode || "extend";
          if (promptMode === "replace") {
            systemPrompt = repository.customPrompt + OUTPUT_FORMAT;
          } else {
            systemPrompt = `${SYSTEM_PROMPT}\n\n【仓库自定义要求】\n${repository.customPrompt}`;
          }
        }

        const batchReviewPrompt = buildBatchReviewPrompt({
          title: mr?.title || reviewLog.title,
          description: mr?.description || reviewLog.description || "",
          files: filesForBatchReview,
          fileCount: relevantDiffs.length,
        });

        const batchResponse = await aiService.reviewCode(
          batchReviewPrompt,
          modelConfig,
          systemPrompt,
        );

        console.log(`\n🤖 [ReviewService] Batch review response received`);
        console.log("┌─────────────────────────────────────────────┐");
        batchResponse.split("\n").slice(0, 20).forEach((line) => console.log(`│ ${line}`));
        if (batchResponse.split("\n").length > 20) {
          console.log(`│ ... (${batchResponse.split("\n").length - 20} more lines)`);
        }
        console.log("└─────────────────────────────────────────────┘");

        // 解析批量审查结果，创建一条总结性评论
        totalComments.push({
          filePath: "summary",
          lineNumber: 1,
          severity: "suggestion",
          content: batchResponse.trim(),
        });

        // 保存批量审查响应
        aiResponsesByFile["batch_review"] = batchResponse;

        await prisma.reviewLog.update({
          where: { id: reviewLogId },
          data: { reviewedFiles: relevantDiffs.length },
        });
      } else {
        // 单文件审查模式（原有逻辑）
        for (const diff of relevantDiffs) {
          const filePath = diff.new_path;
          console.log(`📄 [ReviewService] Reviewing file: ${filePath}`);

          const patch = this.generatePatch(diff);

          // 构建系统提示词（支持 extend/replace 模式）
          let systemPrompt = SYSTEM_PROMPT;

          if (repository.customPrompt) {
            const promptMode = (repository as any).customPromptMode || "extend";
            if (promptMode === "replace") {
              systemPrompt = repository.customPrompt + OUTPUT_FORMAT;
            } else {
              systemPrompt = `${SYSTEM_PROMPT}\n\n【仓库自定义要求】\n${repository.customPrompt}`;
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
          orderBy: { createdAt: "asc" },
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

    const comments = reviewLog.comments;
    if (!comments || comments.length === 0) {
      console.log(`📭 [ReviewService] No comments to post`);
      return;
    }

    try {
      const commentBody = this.formatSummaryComment(reviewLog, comments);
      const result = await gitlabService.createMergeRequestComment(
        reviewLog.repository.gitLabProjectId,
        reviewLog.mergeRequestIid,
        commentBody,
        undefined,
      );

      await prisma.reviewComment.updateMany({
        where: { reviewLogId, isPosted: false },
        data: {
          isPosted: true,
          gitlabCommentId: result.id ? result.id.toString() : null,
        },
      });

      console.log(`✅ Posted summary comment to MR !${reviewLog.mergeRequestIid}`);
    } catch (error) {
      console.error(`❌ Failed to post summary comment to MR !${reviewLog.mergeRequestIid}`);
      throw error;
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

    console.log(`📤 [ReviewService] Posting summary comment to commit`);

    try {
      const commentBody = this.formatSummaryComment(reviewLog, comments);
      const result = await gitlabService.createCommitComment(
        reviewLog.repository.gitLabProjectId,
        reviewLog.commitSha,
        commentBody,
        undefined,
      );

      await prisma.reviewComment.updateMany({
        where: { reviewLogId: reviewLog.id, isPosted: false },
        data: {
          isPosted: true,
          gitlabCommentId: result.id ? result.id.toString() : null,
        },
      });

      console.log(`✅ Posted summary comment to commit ${reviewLog.commitShortId}`);
    } catch (error) {
      console.error(`❌ Failed to post summary comment to commit ${reviewLog.commitShortId}`);
      throw error;
    }
  }

  /** 生成 unified diff 格式 */
  private generatePatch(diff: any): string {
    return `--- a/${diff.old_path}
+++ b/${diff.new_path}
${diff.diff}`;
  }

  /** 汇总评论格式化（按文件分组） */
  private formatSummaryComment(reviewLog: any, comments: ReviewCommentLike[]): string {
    const lines: string[] = [];
    const total = comments.length;
    const critical = reviewLog.criticalIssues ?? 0;
    const normal = reviewLog.normalIssues ?? 0;
    const suggestion = reviewLog.suggestions ?? 0;
    const totalFiles = reviewLog.totalFiles ?? 0;
    const reviewedFiles = reviewLog.reviewedFiles ?? 0;

    // 检查是否是批量审查模式
    const isBatchReview = comments.length === 1 && comments[0].filePath === "summary";

    if (isBatchReview) {
      // 批量审查模式：直接输出 AI 的审查结果
      lines.push("## Code Review Summary");
      lines.push("");
      lines.push(`**Files Reviewed:** ${totalFiles}`);
      if (reviewLog.aiSummary && reviewLog.aiSummary.trim()) {
        lines.push("");
        lines.push("### Overview");
        lines.push(reviewLog.aiSummary.trim());
      }
      lines.push("");
      lines.push("### Review Findings");
      lines.push(comments[0].content);
      lines.push("");
      lines.push("---");
      lines.push(
        "<sub>🤖 Code review by [Code Review Copilot](https://github.com/yuguaa/code-review-copilot)</sub>",
      );
    } else {
      // 单文件审查模式：按文件分组输出
      lines.push("## Code Review Summary");
      lines.push("");
      lines.push(
        `**Files:** ${totalFiles} total (${reviewedFiles} reviewed)`,
      );
      lines.push(
        `**Findings:** 🔴 ${critical} Critical | ⚠️ ${normal} Normal | 💡 ${suggestion} Suggestion | **Total:** ${total}`,
      );

      if (reviewLog.aiSummary && reviewLog.aiSummary.trim()) {
        lines.push("");
        lines.push("### Summary");
        lines.push(reviewLog.aiSummary.trim());
      }

      lines.push("");
      lines.push("### Findings by File");

      const fileOrder: string[] = [];
      const byFile: Record<string, ReviewCommentLike[]> = {};

      for (const comment of comments) {
        const filePath = comment.filePath || "unknown";
        if (!byFile[filePath]) {
          byFile[filePath] = [];
          fileOrder.push(filePath);
        }
        byFile[filePath].push(comment);
      }

      for (const filePath of fileOrder) {
        lines.push("");
        lines.push(`#### \`${filePath}\``);
        for (const comment of byFile[filePath]) {
          const range =
            comment.lineRangeEnd && comment.lineRangeEnd !== comment.lineNumber
              ? `L${comment.lineNumber}-${comment.lineRangeEnd}`
              : `L${comment.lineNumber}`;
          const severity = this.formatSeverityLabel(comment.severity);
          const content = this.formatInlineContent(comment.content);
          lines.push(`- ${range} [${severity}] ${content}`);
        }
      }

      lines.push("");
      lines.push("---");
      lines.push(
        "<sub>🤖 Code review by [Code Review Copilot](https://github.com/yuguaa/code-review-copilot)</sub>",
      );
    }

    return lines.join("\n");
  }

  private formatSeverityLabel(severity?: string | null): string {
    if (!severity) return "Normal";
    const lower = severity.toLowerCase();
    if (lower === "critical") return "Critical";
    if (lower === "suggestion") return "Suggestion";
    return "Normal";
  }

  private formatInlineContent(content: string): string {
    const trimmed = content.trim();
    if (!trimmed) return "";
    return trimmed.replace(/\n+/g, "<br>");
  }
}

export const reviewService = new ReviewService();
