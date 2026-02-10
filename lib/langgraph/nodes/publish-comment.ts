/**
 * @file publish-comment.ts
 * @description LangGraph 节点：发布评论
 *
 * 此节点负责：
 * 1. 遍历收集到的严重问题
 * 2. 调用 GitLab API 发布评论（MR 或 Commit）
 * 3. 记录发布结果
 */

import { prisma } from "@/lib/prisma";
import type { ReviewLog } from "@prisma/client";
import type { ReviewState } from "../types";

/**
 * 发布评论节点
 */
export async function publishCommentNode(state: ReviewState): Promise<Partial<ReviewState>> {
  console.log(`💬 [PublishCommentNode] Publishing comments to GitLab`);

  const gitlabService = state.gitlabService;
  if (!gitlabService) {
    console.error(`❌ [PublishCommentNode] GitLab service not initialized`);
    return {};
  }

  const reviewLog = await prisma.reviewLog.findUnique({
    where: { id: state.reviewLogId },
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
    return {};
  }

  const isPushEvent = reviewLog.mergeRequestIid === 0;
  const projectId = reviewLog.repository.gitLabProjectId;

  // 发布严重问题评论
  for (const comment of state.criticalComments) {
    try {
      if (isPushEvent) {
        // 发布到 Commit
        await gitlabService.createCommitComment(
          projectId,
          reviewLog.commitSha,
          comment.content,
          {
            path: comment.filePath,
            line: comment.lineNumber,
            line_type: "new"
          }
        );
      } else {
        // 发布到 MR
        // 查找 diff 以获取 position 信息
        const diff = state.diffs.find((d) => d.new_path === comment.filePath);
        if (diff) {
          await gitlabService.createMergeRequestComment(
            projectId,
            reviewLog.mergeRequestIid,
            comment.content,
            {
              base_sha: state.mrInfo?.diff_refs?.base_sha,
              start_sha: state.mrInfo?.diff_refs?.start_sha,
              head_sha: state.mrInfo?.diff_refs?.head_sha,
              old_path: diff.old_path,
              new_path: diff.new_path,
              position_type: "text",
              new_line: comment.lineNumber,
            }
          );
        }
      }
    } catch (error) {
      console.error(
        `❌ [PublishCommentNode] Failed to publish comment for ${comment.filePath}:${comment.lineNumber}`,
        error
      );
    }
  }

  // 格式化汇总评论
  const summaryContent = formatSummaryComment(reviewLog, state.summary || "", state.aiResponsesByFile, state.fileResults);

  // 发布总体摘要评论
  try {
    // 检查是否有占位评论需要更新
    const hasPlaceholderComment = reviewLog.gitlabDiscussionId && reviewLog.gitlabNoteId;
    const hasPlaceholderCommitComment = !!reviewLog.gitlabNoteId;

    // 添加调试日志
    console.log(`📋 [PublishCommentNode] Checking placeholder comment status:`);
    console.log(`  - isPushEvent: ${isPushEvent}`);
    console.log(`  - gitlabDiscussionId: ${reviewLog.gitlabDiscussionId}`);
    console.log(`  - gitlabNoteId: ${reviewLog.gitlabNoteId}`);
    console.log(`  - hasPlaceholderComment: ${hasPlaceholderComment}`);
    console.log(`  - hasPlaceholderCommitComment: ${hasPlaceholderCommitComment}`);

    let result: { id: number | string } | null = null;

    if (isPushEvent) {
      if (hasPlaceholderCommitComment) {
        console.log(`📝 [PublishCommentNode] Updating placeholder commit comment: noteId=${reviewLog.gitlabNoteId}`);
        result = await gitlabService.updateCommitComment(
          projectId,
          reviewLog.commitSha,
          reviewLog.gitlabNoteId!,
          summaryContent
        ) as { id: number | string };
      } else {
        console.log(`📝 [PublishCommentNode] Posting new commit comment`);
        result = await gitlabService.createCommitComment(
          projectId,
          reviewLog.commitSha,
          summaryContent
        ) as { id: number | string };
      }
    } else {
      if (hasPlaceholderComment) {
        console.log(`📝 [PublishCommentNode] Updating placeholder MR comment: discussionId=${reviewLog.gitlabDiscussionId}`);
        result = await gitlabService.updateMergeRequestComment(
          projectId,
          reviewLog.mergeRequestIid,
          reviewLog.gitlabDiscussionId!,
          reviewLog.gitlabNoteId!,
          summaryContent
        ) as { id: number | string };
      } else {
        console.log(`📝 [PublishCommentNode] Posting new MR comment`);
        result = await gitlabService.createMergeRequestComment(
          projectId,
          reviewLog.mergeRequestIid,
          summaryContent
        ) as { id: number | string };
      }
    }

    // 更新评论状态
    await prisma.reviewComment.updateMany({
      where: { reviewLogId: state.reviewLogId, isPosted: false },
      data: {
        isPosted: true,
        gitlabCommentId: result?.id ? result.id.toString() : null,
      },
    });

  } catch (error) {
    console.error(
      `❌ [PublishCommentNode] Failed to publish summary comment`,
      error
    );
  }

  return {
    completed: true,
  };
}

/** 汇总评论格式化 */
function formatSummaryComment(
  reviewLog: ReviewLog,
  summary: string,
  aiResponses: Record<string, string>,
  fileResults: Array<{ filePath: string; counts: { critical: number; normal: number; suggestion: number } }>
): string {
  const lines: string[] = [];
  const critical = reviewLog.criticalIssues ?? 0;
  const normal = reviewLog.normalIssues ?? 0;
  const suggestion = reviewLog.suggestions ?? 0;
  const totalFiles = reviewLog.totalFiles ?? 0;
  const reviewedFiles = reviewLog.reviewedFiles ?? 0;

  // 计算有问题的问题数量（至少有一个问题）
  const filesWithIssues = fileResults.filter(
    f => f.counts.critical > 0 || f.counts.normal > 0 || f.counts.suggestion > 0
  ).length;

  lines.push("## ✅ Code Review Complete");
  lines.push("");
  lines.push(`**Files:** ${totalFiles} total (${reviewedFiles} reviewed, ${filesWithIssues} with issues)`);
  lines.push(`**Total Findings:** 🔴 ${critical} | ⚠️ ${normal} | 💡 ${suggestion}`);

  // 添加变更摘要
  if (summary) {
    lines.push("");
    lines.push("### 📝 Change Summary");
    lines.push(summary);
  }

  // 只显示有问题的文件
  if (fileResults && fileResults.length > 0) {
    const filesWithProblems = fileResults.filter(
      f => f.counts.critical > 0 || f.counts.normal > 0 || f.counts.suggestion > 0
    );

    if (filesWithProblems.length > 0) {
      lines.push("");
      lines.push("---");
      lines.push("");
      lines.push("### 🔍 Files with Issues");
      lines.push("");

      for (const fileResult of filesWithProblems) {
        const aiResponse = aiResponses[fileResult.filePath];
        if (!aiResponse) continue;

        lines.push(`#### 📄 \`${fileResult.filePath}\``);
        lines.push("");

        // 清理 AI 响应，移除多余的格式符号
        const cleanedResponse = aiResponse
          .replace(/^#+\s*/gm, '') // 移除开头的 #
          .replace(/^\**\s*\**/gm, '') // 移除开头的 **，保留格式
          .trim();

        // 将响应按行分割并格式化
        const responseLines = cleanedResponse.split('\n');
        for (const line of responseLines) {
          if (line.trim()) {
            lines.push(line.trim());
          }
        }
        lines.push("");
      }
    }
  }

  lines.push("");
  lines.push(`<sub>⏱️ 完成时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</sub>`);

  return lines.join("\n");
}
