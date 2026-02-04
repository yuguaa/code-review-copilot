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
import { createHash } from "crypto";
import {
  buildReviewPrompt,
  buildSummaryPrompt,
  buildBatchReviewPrompt,
  SYSTEM_PROMPT,
  OUTPUT_FORMAT,
  SUMMARY_SYSTEM_PROMPT,
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

      // 摘要生成不要复用 SYSTEM_PROMPT（SYSTEM_PROMPT 可能要求输出统计行）
      const summary = await aiService.reviewCode(
        summaryPrompt,
        modelConfig,
        SUMMARY_SYSTEM_PROMPT,
      );

      await prisma.reviewLog.update({
        where: { id: reviewLogId },
        data: { aiSummary: summary },
      });

      // 逐文件进行审查
      const criticalComments: ReviewComment[] = [];
      const totalCounts = { critical: 0, normal: 0, suggestion: 0 };
      const aiResponsesByFile: Record<string, string> = {};
      const reviewPromptsByFile: Record<string, string> = {}; // 记录每个文件的 prompt

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

        // 记录完整的 prompt（包含系统提示词）
        reviewPromptsByFile["batch_review"] = `=== System Prompt ===\n${systemPrompt}\n\n=== User Prompt ===\n${batchReviewPrompt}`;

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

        const parsed = aiService.parseReviewSummary(batchResponse, {
          maxCriticalItems: 3,
        });
        totalCounts.critical += parsed.counts.critical;
        totalCounts.normal += parsed.counts.normal;
        totalCounts.suggestion += parsed.counts.suggestion;

        for (const item of parsed.criticalItems) {
          criticalComments.push({
            filePath: item.filePath,
            lineNumber: item.lineNumber,
            lineRangeEnd: item.lineRangeEnd,
            severity: "critical",
            content: item.content,
          });
        }

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

          // 记录完整的 prompt（包含系统提示词）
          reviewPromptsByFile[filePath] = `=== System Prompt ===\n${systemPrompt}\n\n=== User Prompt ===\n${reviewPrompt}`;

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

          const parsed = aiService.parseReviewSummary(aiResponse, {
            defaultFilePath: filePath,
            maxCriticalItems: 2,
          });
          totalCounts.critical += parsed.counts.critical;
          totalCounts.normal += parsed.counts.normal;
          totalCounts.suggestion += parsed.counts.suggestion;

          for (const item of parsed.criticalItems) {
            criticalComments.push({
              filePath: item.filePath || filePath,
              lineNumber: item.lineNumber,
              lineRangeEnd: item.lineRangeEnd,
              severity: "critical",
              content: item.content,
            });
          }

          await prisma.reviewLog.update({
            where: { id: reviewLogId },
            data: { reviewedFiles: { increment: 1 } },
          });
        }
      }

      // 统计问题（来自“统计行”或 fallback 推断）
      const criticalIssues = totalCounts.critical;
      const normalIssues = totalCounts.normal;
      const suggestions = totalCounts.suggestion;

      console.log(`📊 [ReviewService] Review complete:`);
      console.log(`   🔴 Critical: ${criticalIssues}`);
      console.log(`   ⚠️ Normal: ${normalIssues}`);
      console.log(`   💡 Suggestions: ${suggestions}`);

      // 保存评论
      // 只存储“严重”问题的明细，其余仅计数，避免噪音。
      for (const comment of criticalComments.slice(0, 3)) {
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
          reviewPrompts: JSON.stringify(reviewPromptsByFile),
          aiModelProvider: modelConfig.provider,
          aiModelId: modelConfig.modelId,
        },
      });

      await this.postCommentsToGitLab(reviewLogId, gitlabService);

      return {
        success: true,
        totalComments: criticalIssues + normalIssues + suggestions,
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
   * 如果存在占位评论（gitlabDiscussionId + gitlabNoteId），则更新占位评论
   * 否则创建新评论
   */
  async postCommentsToGitLab(reviewLogId: string, gitlabService: any) {
    const reviewLog = await prisma.reviewLog.findUnique({
      where: { id: reviewLogId },
      include: {
        repository: {
          include: {
            gitLabAccount: true,
          },
        },
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

    const comments = reviewLog.comments || [];

    try {
      const commentBody = this.formatSummaryComment(reviewLog, comments);
      
      // 检查是否有占位评论需要更新
      const hasPlaceholderComment = reviewLog.gitlabDiscussionId && reviewLog.gitlabNoteId;
      
      let result: any;
      if (hasPlaceholderComment) {
        // 更新占位评论
        console.log(`📝 [ReviewService] Updating placeholder comment: discussionId=${reviewLog.gitlabDiscussionId}, noteId=${reviewLog.gitlabNoteId}`);
        result = await gitlabService.updateMergeRequestComment(
          reviewLog.repository.gitLabProjectId,
          reviewLog.mergeRequestIid,
          reviewLog.gitlabDiscussionId,
          reviewLog.gitlabNoteId,
          commentBody
        );
        console.log(`✅ Updated placeholder comment to MR !${reviewLog.mergeRequestIid}`);
      } else {
        // 创建新评论
        result = await gitlabService.createMergeRequestComment(
          reviewLog.repository.gitLabProjectId,
          reviewLog.mergeRequestIid,
          commentBody,
          undefined,
        );
        console.log(`✅ Posted new summary comment to MR !${reviewLog.mergeRequestIid}`);
      }

      await prisma.reviewComment.updateMany({
        where: { reviewLogId, isPosted: false },
        data: {
          isPosted: true,
          gitlabCommentId: result.id ? result.id.toString() : null,
        },
      });
    } catch (error) {
      console.error(`❌ Failed to post/update comment to MR !${reviewLog.mergeRequestIid}`);
      throw error;
    }
  }

  /**
   * 发布评论到 GitLab Commit（Push 事件）
   * 如果存在占位评论（gitlabNoteId），则尝试更新占位评论
   * 否则创建新评论
   */
  async postCommentsToCommit(reviewLog: any, gitlabService: any) {
    const comments = reviewLog.comments || [];

    console.log(`📤 [ReviewService] Posting summary comment to commit`);

    try {
      const commentBody = this.formatSummaryComment(reviewLog, comments);
      
      // 检查是否有占位评论需要更新
      const hasPlaceholderComment = !!reviewLog.gitlabNoteId;
      
      let result: any;
      if (hasPlaceholderComment) {
        // 尝试更新占位评论
        console.log(`📝 [ReviewService] Updating placeholder commit comment: noteId=${reviewLog.gitlabNoteId}`);
        result = await gitlabService.updateCommitComment(
          reviewLog.repository.gitLabProjectId,
          reviewLog.commitSha,
          reviewLog.gitlabNoteId,
          commentBody
        );
        console.log(`✅ Updated placeholder comment to commit ${reviewLog.commitShortId}`);
      } else {
        // 创建新评论
        result = await gitlabService.createCommitComment(
          reviewLog.repository.gitLabProjectId,
          reviewLog.commitSha,
          commentBody,
          undefined,
        );
        console.log(`✅ Posted new summary comment to commit ${reviewLog.commitShortId}`);
      }

      await prisma.reviewComment.updateMany({
        where: { reviewLogId: reviewLog.id, isPosted: false },
        data: {
          isPosted: true,
          gitlabCommentId: result.id ? result.id.toString() : null,
        },
      });
    } catch (error) {
      console.error(`❌ Failed to post/update summary comment to commit ${reviewLog.commitShortId}`);
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
    const critical = reviewLog.criticalIssues ?? 0;
    const normal = reviewLog.normalIssues ?? 0;
    const suggestion = reviewLog.suggestions ?? 0;
    const totalFiles = reviewLog.totalFiles ?? 0;
    const reviewedFiles = reviewLog.reviewedFiles ?? 0;

    const baseUrl = reviewLog.repository?.gitLabAccount?.url?.replace(/\/+$/, "");
    const projectPath = reviewLog.repository?.path;
    const isPushEvent = reviewLog.mergeRequestIid === 0;
    const ref = reviewLog.commitSha || reviewLog.sourceBranch;

    const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");
    const diffAnchor = (filePath: string, lineNumber: number, lineRangeEnd?: number | null) => {
      const hash = createHash("sha1").update(filePath).digest("hex");
      const end = lineRangeEnd && lineRangeEnd !== lineNumber ? lineRangeEnd : lineNumber;
      return `${hash}_${lineNumber}_${end}`;
    };

    const mrUrl =
      baseUrl && projectPath && !isPushEvent
        ? `${baseUrl}/${projectPath}/-/merge_requests/${reviewLog.mergeRequestIid}`
        : null;
    const mrDiffUrl = mrUrl ? `${mrUrl}/diffs` : null;
    const commitUrl =
      baseUrl && projectPath && ref
        ? `${baseUrl}/${projectPath}/-/commit/${ref}`
        : null;

    const fileDiffUrl = (filePath: string, lineNumber: number, lineRangeEnd?: number | null) => {
      if (!baseUrl || !projectPath || !ref || !filePath || !lineNumber) return null;
      const anchor = diffAnchor(filePath, lineNumber, lineRangeEnd);
      if (!isPushEvent && mrDiffUrl) return `${mrDiffUrl}#${anchor}`;
      if (commitUrl) return `${commitUrl}#${anchor}`;
      // fallback: blob view
      const range =
        lineRangeEnd && lineRangeEnd !== lineNumber
          ? `#L${lineNumber}-${lineRangeEnd}`
          : `#L${lineNumber}`;
      return `${baseUrl}/${projectPath}/-/blob/${ref}/${encodePath(filePath)}${range}`;
    };

    lines.push("## Code Review Summary");
    lines.push("");
    lines.push(`**Files:** ${totalFiles} total (${reviewedFiles} reviewed)`);
    lines.push(`**Counts:** 🔴 ${critical} | ⚠️ ${normal} | 💡 ${suggestion}`);
    const totalCount = critical + normal + suggestion;
    lines.push(`**Total Findings:** ${totalCount}`);

    // 直接拼接 AI 原始输出（不加标题）
    try {
      const raw = typeof reviewLog.aiResponse === "string" ? reviewLog.aiResponse : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        const batch = parsed?.batch_review;
        let output = "";
        if (typeof batch === "string" && batch.trim()) {
          output = batch.trim();
        } else {
          const parts = Object.values(parsed)
            .filter((v) => typeof v === "string")
            .map((v) => (v as string).trim())
            .filter(Boolean);
          output = parts.join("\n\n");
        }
        if (output) {
          const maxLen = 6000;
          const shown = output.length > maxLen ? `${output.slice(0, maxLen)}\n…(truncated)` : output;
          lines.push("");
          lines.push(shown);
        }
      }
    } catch {
      // ignore
    }

    lines.push("");
    lines.push("---");
    lines.push(
      "<sub>🤖 Code review by [Code Review Copilot](https://github.com/yuguaa/code-review-copilot)</sub>",
    );

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
