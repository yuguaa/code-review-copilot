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
import type { ReviewComment, ReviewLog } from "@prisma/client";
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

  // 总评模式：不发布行内评论，所有内容汇总到总评中

  // 格式化汇总评论
  const summaryContent = formatSummaryComment(
    reviewLog,
    state.summary || "",
    state.fileResults,
    reviewLog.comments,
    state.reviewScope,
    state.incrementalBaseSha
  );

  // 发布总体摘要评论
  try {
    // 检查是否有占位评论需要更新
    const hasPlaceholderCommitComment = !!reviewLog.gitlabNoteId;

    let result: { id: number | string } | null = null;

    if (isPushEvent) {
      const pushMarker = reviewLog.gitlabDiscussionId || `CRC_PUSH_PLACEHOLDER:${state.reviewLogId}`;
      let resolvedNoteId = reviewLog.gitlabNoteId || null;

      if (!resolvedNoteId) {
        try {
          const commitComments = await gitlabService.getCommitComments(
            projectId,
            reviewLog.commitSha
          );
          const markerComment = [...commitComments]
            .reverse()
            .find((item) => typeof item.note === "string" && item.note.includes(pushMarker));
          const markerNoteId = markerComment?.id || markerComment?.note_id || null;
          if (markerNoteId) {
            resolvedNoteId = markerNoteId;
            await prisma.reviewLog.update({
              where: { id: state.reviewLogId },
              data: { gitlabNoteId: resolvedNoteId },
            });
            console.log(`📝 [PublishCommentNode] Resolved placeholder commit noteId=${resolvedNoteId} by marker=${pushMarker}`);
          }
        } catch (error) {
          console.warn(`⚠️ [PublishCommentNode] Failed to resolve commit placeholder by marker`, error);
        }
      }

      if (resolvedNoteId || hasPlaceholderCommitComment) {
        console.log(`📝 [PublishCommentNode] Updating placeholder commit comment: noteId=${resolvedNoteId || reviewLog.gitlabNoteId}`);
        result = await gitlabService.updateCommitComment(
          projectId,
          reviewLog.commitSha,
          (resolvedNoteId || reviewLog.gitlabNoteId)!,
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
      const resolvedDiscussionId = reviewLog.gitlabDiscussionId || null;
      let resolvedNoteId = reviewLog.gitlabNoteId || null;

      if (resolvedDiscussionId && !resolvedNoteId) {
        try {
          const discussion = await gitlabService.getMergeRequestDiscussion(
            projectId,
            reviewLog.mergeRequestIid,
            resolvedDiscussionId
          );
          const firstNoteId = discussion?.notes?.[0]?.id;
          if (typeof firstNoteId === "number" && Number.isInteger(firstNoteId)) {
            resolvedNoteId = firstNoteId;
            await prisma.reviewLog.update({
              where: { id: state.reviewLogId },
              data: { gitlabNoteId: resolvedNoteId },
            });
            console.log(`📝 [PublishCommentNode] Resolved placeholder noteId=${resolvedNoteId} from discussion`);
          }
        } catch (error) {
          console.warn(`⚠️ [PublishCommentNode] Failed to resolve placeholder noteId, fallback to create new summary`, error);
        }
      }

      if (resolvedDiscussionId && resolvedNoteId) {
        console.log(`📝 [PublishCommentNode] Updating placeholder MR comment: discussionId=${resolvedDiscussionId}`);
        result = await gitlabService.updateMergeRequestComment(
          projectId,
          reviewLog.mergeRequestIid,
          resolvedDiscussionId,
          resolvedNoteId,
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
  fileResults: Array<{ filePath: string; counts: { critical: number; normal: number; suggestion: number } }>,
  postedComments: ReviewComment[],
  reviewScope: "full" | "incremental",
  incrementalBaseSha: string | null
): string {
  const lines: string[] = [];
  const critical = reviewLog.criticalIssues ?? 0;
  const normal = reviewLog.normalIssues ?? 0;
  const suggestion = reviewLog.suggestions ?? 0;
  const totalFiles = reviewLog.totalFiles ?? 0;
  const reviewedFiles = reviewLog.reviewedFiles ?? 0;

  const filesWithIssues = fileResults.filter(
    (file) => file.counts.critical > 0 || file.counts.normal > 0 || file.counts.suggestion > 0
  ).length;

  const reviewResult = getReviewConclusion(critical, normal, suggestion);
  const topFiles = [...fileResults]
    .filter((file) => file.counts.critical > 0 || file.counts.normal > 0 || file.counts.suggestion > 0)
    .sort((a, b) => {
      const scoreA = a.counts.critical * 5 + a.counts.normal * 2 + a.counts.suggestion;
      const scoreB = b.counts.critical * 5 + b.counts.normal * 2 + b.counts.suggestion;
      return scoreB - scoreA;
    })
    .slice(0, 5);

  lines.push("## 🤖 Code Review Copilot");
  lines.push("");
  lines.push(`> **结论：${reviewResult}**`);
  lines.push("");

  lines.push("### 概览");
  if (reviewScope === "incremental") {
    lines.push(`- 审查模式：增量审查（基线 ${shortSha(incrementalBaseSha)} -> 当前 ${shortSha(reviewLog.commitSha)}）`);
  } else {
    lines.push(`- 审查模式：全量审查（当前 MR/Commit 全部变更）`);
  }
  lines.push(`- 审查文件：${reviewedFiles}/${totalFiles}（其中 ${filesWithIssues} 个文件存在问题）`);
  lines.push(`- 问题统计：🔴 严重 ${critical} / ⚠️ 一般 ${normal} / 💡 建议 ${suggestion}`);

  if (summary) {
    lines.push("");
    lines.push("### 变更摘要");
    lines.push(summary);
  }

  lines.push("");
  const sortedComments = [...postedComments].sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity));
  const criticalComments = sortedComments.filter((item) => item.severity === "critical");
  const normalComments = sortedComments.filter((item) => item.severity === "normal");
  const suggestionComments = sortedComments.filter((item) => item.severity === "suggestion");
  const actionableCount = criticalComments.length + normalComments.length;
  const nitpickCount = suggestionComments.length;

  lines.push("### Review Index");
  lines.push(`Actionable comments posted: **${actionableCount}**`);
  lines.push("");
  lines.push(`<details>`);
  lines.push(`<summary>🔧 Actionable comments (${actionableCount})</summary>`);
  lines.push("");
  if (actionableCount === 0) {
    lines.push("- 无需要立即处理的问题。");
  } else {
    const actionablePreview = [...criticalComments, ...normalComments].slice(0, 5);
    actionablePreview.forEach((comment) => {
      const location = comment.lineRangeEnd
        ? `${comment.filePath}:${comment.lineNumber}-${comment.lineRangeEnd}`
        : `${comment.filePath}:${comment.lineNumber}`;
      lines.push(`- \`${location}\` (${comment.severity === "critical" ? "严重" : "一般"})`);
    });
    if (actionableCount > actionablePreview.length) {
      lines.push(`- 以及其余 ${actionableCount - actionablePreview.length} 条`);
    }
  }
  lines.push(`</details>`);
  lines.push("");
  lines.push(`<details>`);
  lines.push(`<summary>🧹 Nitpick comments (${nitpickCount})</summary>`);
  lines.push("");
  if (nitpickCount === 0) {
    lines.push("- 无 nitpick。");
  } else {
    suggestionComments.slice(0, 5).forEach((comment) => {
      const location = comment.lineRangeEnd
        ? `${comment.filePath}:${comment.lineNumber}-${comment.lineRangeEnd}`
        : `${comment.filePath}:${comment.lineNumber}`;
      lines.push(`- \`${location}\``);
    });
    if (nitpickCount > 5) {
      lines.push(`- 以及其余 ${nitpickCount - 5} 条`);
    }
  }
  lines.push(`</details>`);
  lines.push("");
  lines.push(`<details>`);
  lines.push(`<summary>📜 Review details</summary>`);
  lines.push("");

  lines.push("### 高优先级问题");
  if (criticalComments.length === 0) {
    lines.push("- 本次未发现需要立即阻断合并的严重问题。");
  } else {
    criticalComments.slice(0, 3).forEach((comment, index) => {
      const finding = parseStructuredFinding(comment.content);
      const location = comment.lineRangeEnd
        ? `${comment.filePath}:${comment.lineNumber}-${comment.lineRangeEnd}`
        : `${comment.filePath}:${comment.lineNumber}`;

      lines.push(`${index + 1}. \`${location}\``);
      lines.push(`   - 问题：${finding.issue}`);
      lines.push(`   - 影响：${finding.impact}`);
      lines.push(`   - 建议：${finding.suggestion}`);
    });
  }

  lines.push("");
  lines.push("### 一般与建议（摘要）");
  if (normalComments.length === 0 && suggestionComments.length === 0) {
    lines.push("- 本次无一般/建议级问题。");
  } else {
    if (normalComments.length > 0) {
      lines.push(`- ⚠️ 一般问题 ${normalComments.length} 条（示例：\`${normalComments[0].filePath}:${normalComments[0].lineNumber}\`）`);
    }
    if (suggestionComments.length > 0) {
      lines.push(`- 💡 建议问题 ${suggestionComments.length} 条（示例：\`${suggestionComments[0].filePath}:${suggestionComments[0].lineNumber}\`）`);
    }
  }

  lines.push("");
  lines.push("### 文件风险排行");
  if (topFiles.length === 0) {
    lines.push("- 未发现问题文件。");
  } else {
    for (const file of topFiles) {
      lines.push(`- \`${file.filePath}\`：🔴 ${file.counts.critical} / ⚠️ ${file.counts.normal} / 💡 ${file.counts.suggestion}`);
    }
  }

  lines.push("");
  lines.push("### 建议处理顺序");
  if (critical > 0) {
    lines.push("1. 优先修复所有严重问题并回归验证。");
    lines.push("2. 处理一般问题，避免在后续迭代放大风险。");
    lines.push("3. 建议类问题按收益排期优化。");
  } else if (normal > 0) {
    lines.push("1. 本次可继续评审，但建议先处理一般问题。");
    lines.push("2. 建议类问题可在合并后安排优化。");
  } else {
    lines.push("1. 风险较低，可继续合并流程。");
    lines.push("2. 建议关注可维护性优化项。");
  }

  lines.push("");
  lines.push(`<sub>完成时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</sub>`);
  lines.push("");
  lines.push(`</details>`);

  return lines.join("\n");
}

function getReviewConclusion(critical: number, normal: number, suggestion: number): string {
  if (critical > 0) return `高风险：发现 ${critical} 个严重问题，建议修复后再合并`;
  if (normal > 0) return `中风险：无严重问题，但有 ${normal} 个一般问题需要关注`;
  if (suggestion > 0) return `低风险：仅有 ${suggestion} 条优化建议`;
  return "通过：未发现明显问题";
}

function parseStructuredFinding(content: string): { issue: string; impact: string; suggestion: string } {
  const clean = content.trim();
  const segments = clean.split(/[｜|]/).map((segment) => segment.trim()).filter(Boolean);

  let issue = "";
  let impact = "";
  let suggestion = "";

  for (const segment of segments) {
    if (segment.startsWith("问题：")) issue = segment.replace(/^问题：/, "").trim();
    if (segment.startsWith("影响：")) impact = segment.replace(/^影响：/, "").trim();
    if (segment.startsWith("建议：")) suggestion = segment.replace(/^建议：/, "").trim();
  }

  if (!issue) issue = clean;
  if (!impact) impact = "可能引入功能错误、稳定性或可维护性风险。";
  if (!suggestion) suggestion = "请按该点修复并补充必要回归验证。";

  return { issue, impact, suggestion };
}

function severityWeight(severity: string): number {
  if (severity === "critical") return 3;
  if (severity === "normal") return 2;
  return 1;
}


function shortSha(sha: string | null | undefined): string {
  if (!sha) return "unknown";
  return sha.slice(0, 8);
}
