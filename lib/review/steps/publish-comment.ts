/**
 * @file publish-comment.ts
 * @description 审查步骤：发布评论
 *
 * 此步骤负责：
 * 1. 遍历收集到的严重问题
 * 2. 调用 GitLab API 发布评论（MR 或 Commit）
 * 3. 记录发布结果
 */

import { prisma } from "@/lib/prisma";
import { sendReviewToDingTalk } from "@/lib/services/dingtalk";
import type { ReviewComment, ReviewLog } from "@prisma/client";
import type { ReviewState } from "../types";
import { createLogger, logError, logWarn } from "@/lib/logger";
import { REVIEW_CANCELLED_STATUS, ReviewCancelledError } from "@/lib/services/review-cancellation";

const log = createLogger("PublishCommentStep");

type PiRunForSummary = {
  status: string;
  summary: string | null;
  modelName: string;
  piProfile: { name: string } | null;
};

function markReviewCompleted(reviewLogId: string): Promise<void> {
  return prisma.reviewLog.updateMany({
    where: {
      id: reviewLogId,
      status: "pending",
    },
    data: {
      status: "completed",
      completedAt: new Date(),
      error: null,
    },
  }).then((result) => {
    if (result.count > 0) return undefined;

    return prisma.reviewLog.findUnique({
      where: { id: reviewLogId },
      select: { status: true },
    }).then((reviewLog) => {
      if (reviewLog?.status === REVIEW_CANCELLED_STATUS) {
        throw new ReviewCancelledError(reviewLogId);
      }
      throw new Error("Review log is no longer pending");
    });
  });
}

/**
 * 发布评论
 */
export async function publishCommentStep(state: ReviewState): Promise<Partial<ReviewState>> {
  log.info(`💬 [PublishCommentStep] Publishing comments to GitLab`);

  const gitlabService = state.gitlabService;
  if (!gitlabService) {
    log.error(`❌ [PublishCommentStep] GitLab service not initialized`);
    return {
      completed: true,
      error: "GitLab service not initialized",
    };
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
      piRuns: {
        orderBy: { startedAt: "asc" },
        include: {
          piProfile: { select: { name: true } },
        },
      },
    },
  });

  if (!reviewLog) {
    return {
      completed: true,
      error: "Review log not found",
    };
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
    reviewLog.piRuns,
    state.reviewScope,
    state.incrementalBaseSha
  );

  // 发布总体摘要评论
  let publishError: string | null = null;

  try {
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
          const markerNoteId = markerComment?.note_id || markerComment?.id || null;
          if (markerNoteId) {
            resolvedNoteId = markerNoteId;
            await prisma.reviewLog.update({
              where: { id: state.reviewLogId },
              data: { gitlabNoteId: resolvedNoteId },
            });
            log.info(`📝 [PublishCommentStep] Resolved placeholder commit noteId=${resolvedNoteId} by marker=${pushMarker}`);
          }
        } catch (error) {
          logWarn(log, error, `⚠️ [PublishCommentStep] Failed to resolve commit placeholder by marker`);
        }
      }

      if (resolvedNoteId) {
        log.info(`📝 [PublishCommentStep] Updating placeholder commit comment: noteId=${resolvedNoteId || reviewLog.gitlabNoteId}`);
        try {
          result = await gitlabService.updateCommitComment(
            projectId,
            reviewLog.commitSha,
            resolvedNoteId,
            summaryContent
          ) as { id: number | string };
        } catch (updateError) {
          logWarn(log, updateError, `⚠️ [PublishCommentStep] Failed to update commit placeholder(noteId=${resolvedNoteId}), fallback to create summary`);
          result = await gitlabService.createCommitComment(
            projectId,
            reviewLog.commitSha,
            summaryContent
          ) as { id: number | string };
        }
      } else {
        log.warn(`⚠️ [PublishCommentStep] Unable to resolve placeholder by marker=${pushMarker}, fallback to create summary`);
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
            log.info(`📝 [PublishCommentStep] Resolved placeholder noteId=${resolvedNoteId} from discussion`);
          }
        } catch {
          log.warn(`⚠️ [PublishCommentStep] Failed to resolve placeholder noteId, fallback to create new summary`);
        }
      }

      if (resolvedDiscussionId && resolvedNoteId) {
        log.info(`📝 [PublishCommentStep] Updating placeholder MR comment: discussionId=${resolvedDiscussionId}`);
        result = await gitlabService.updateMergeRequestComment(
          projectId,
          reviewLog.mergeRequestIid,
          resolvedDiscussionId,
          resolvedNoteId,
          summaryContent
        ) as { id: number | string };
      } else {
        log.info(`📝 [PublishCommentStep] Posting new MR comment`);
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
    logError(log, error, "❌ [PublishCommentStep] Failed to publish summary comment");
    publishError = error instanceof Error ? error.message : "Failed to publish summary comment";
  }

  if (!publishError) {
    await markReviewCompleted(state.reviewLogId);
  }

  // 发送钉钉机器人通知（不影响主流程）
  await sendReviewToDingTalk({
    reviewLog,
    repositoryName: reviewLog.repository.name,
    repositoryPath: reviewLog.repository.path,
    gitlabUrl: reviewLog.repository.gitLabAccount.url,
    messageOverride: summaryContent,
  }).catch((error) => {
    logWarn(log, error, `⚠️ [PublishCommentStep] Failed to send DingTalk notification`);
  });

  return {
    completed: true,
    error: publishError,
  };
}

/** 汇总评论格式化 */
function formatSummaryComment(
  reviewLog: ReviewLog,
  summary: string,
  fileResults: Array<{ filePath: string; counts: { critical: number; normal: number; suggestion: number } }>,
  postedComments: ReviewComment[],
  piRuns: PiRunForSummary[],
  reviewScope: "full" | "incremental",
  incrementalBaseSha: string | null
): string {
  const lines: string[] = [];
  const sortedComments = [...postedComments].sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity));
  const criticalComments = sortedComments.filter((item) => item.severity === "critical");
  const normalComments = sortedComments.filter((item) => item.severity === "normal");
  const suggestionComments = sortedComments.filter((item) => item.severity === "suggestion");
  // 评论展示统计口径：按“实际可展示的问题清单”计算，避免与概览不一致
  const critical = criticalComments.length;
  const normal = normalComments.length;
  const suggestion = suggestionComments.length;
  const totalFiles = reviewLog.totalFiles ?? 0;
  const reviewedFiles = reviewLog.reviewedFiles ?? 0;

  const filesWithIssues = fileResults.filter(
    (file) => file.counts.critical > 0 || file.counts.normal > 0 || file.counts.suggestion > 0
  ).length;

  const reviewResult = getReviewConclusion(critical, normal, suggestion);
  const topFiles = buildFileRiskRank(sortedComments);

  lines.push("## 🤖 Code Review Copilot");
  lines.push("");
  lines.push(`> **结论：${reviewResult}**`);
  lines.push("");

  lines.push("### 概览");
  if (reviewScope === "incremental") {
    lines.push(`- 审查模式：Push 范围审查（${shortSha(incrementalBaseSha)} -> ${shortSha(reviewLog.commitSha)} 的完整变更）`);
  } else {
    lines.push(`- 审查模式：全量审查（当前 MR/Commit 完整变更）`);
  }
  lines.push(`- 审查文件：${reviewedFiles}/${totalFiles}（其中 ${filesWithIssues} 个文件存在问题）`);
  lines.push(`- 问题统计：🔴 严重 ${critical} / ⚠️ 一般 ${normal} / 💡 建议 ${suggestion}`);
  lines.push(`- Pi Profile：${piRuns.length} 个`);

  lines.push("");
  const actionableCount = criticalComments.length + normalComments.length;
  const nitpickCount = suggestionComments.length;

  lines.push("### 问题索引");
  lines.push(`Actionable comments posted: **${actionableCount}**`);
  lines.push("");
  if (actionableCount === 0) {
    lines.push("- 无需要立即处理的问题。");
  } else {
    [...criticalComments, ...normalComments].forEach((comment) => {
      const location = comment.lineRangeEnd
        ? `${comment.filePath}:${comment.lineNumber}-${comment.lineRangeEnd}`
        : `${comment.filePath}:${comment.lineNumber}`;
      lines.push(`- \`${location}\` (${comment.severity === "critical" ? "严重" : "一般"})`);
    })
  }
  lines.push("");
  lines.push(`Nitpick comments: **${nitpickCount}**`);
  if (nitpickCount === 0) {
    lines.push("- 无 nitpick。");
  } else {
    suggestionComments.forEach((comment) => {
      const location = comment.lineRangeEnd
        ? `${comment.filePath}:${comment.lineNumber}-${comment.lineRangeEnd}`
        : `${comment.filePath}:${comment.lineNumber}`;
      lines.push(`- \`${location}\``);
    })
  }
  lines.push("");

  lines.push("### 全部问题清单");
  if (sortedComments.length === 0) {
    lines.push("- 本次无可定位问题。");
  } else {
    sortedComments.forEach((comment, index) => {
      const finding = parseStructuredFinding(comment.content);
      const location = comment.lineRangeEnd
        ? `${comment.filePath}:${comment.lineNumber}-${comment.lineRangeEnd}`
        : `${comment.filePath}:${comment.lineNumber}`;
      const tag = comment.severity === "critical" ? "严重" : comment.severity === "normal" ? "一般" : "建议";

      lines.push(`${index + 1}. [${tag}] \`${location}\``);
      lines.push(`   - 问题：${finding.issue}`);
      lines.push(`   - 影响：${finding.impact}`);
      lines.push(`   - 建议：${finding.suggestion}`);
      lines.push(`   - 来源：${formatCommentSources(comment)}`);
    });
  }

  lines.push("");
  lines.push("### 文件风险排行");
  if (topFiles.length === 0) {
    lines.push("- 未发现问题文件。");
  } else {
    for (const file of topFiles) {
      lines.push(`- \`${file.filePath}\`：🔴 ${file.critical} / ⚠️ ${file.normal} / 💡 ${file.suggestion}`);
    }
  }

  if (summary) {
    lines.push("");
    lines.push("### 技术走查");
    lines.push(stripSummaryHeading(summary));
  }

  lines.push("");
  lines.push("### Pi Profile 结果");
  if (piRuns.length === 0) {
    lines.push("- 未记录 Pi Profile 执行结果。");
  } else {
    piRuns.forEach((piRun) => {
      const profileName = piRun.piProfile?.name || "未知 Profile";
      lines.push(`- **${profileName}** / \`${piRun.modelName}\`：${formatPiRunStatus(piRun.status)}${piRun.summary ? `，${piRun.summary}` : ""}`);
    });
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

  return lines.join("\n");
}

function stripSummaryHeading(summary: string): string {
  return summary
    .replace(/^###\s*高层总结\s*/m, "")
    .replace(/^###\s*技术走查\s*/m, "")
    .trim();
}

function buildFileRiskRank(comments: ReviewComment[]): Array<{ filePath: string; critical: number; normal: number; suggestion: number }> {
  const map = new Map<string, { filePath: string; critical: number; normal: number; suggestion: number }>();

  comments.forEach((comment) => {
    const current = map.get(comment.filePath) || {
      filePath: comment.filePath,
      critical: 0,
      normal: 0,
      suggestion: 0,
    };

    if (comment.severity === "critical") current.critical += 1;
    if (comment.severity === "normal") current.normal += 1;
    if (comment.severity === "suggestion") current.suggestion += 1;
    map.set(comment.filePath, current);
  });

  return [...map.values()]
    .sort((a, b) => {
      const scoreA = a.critical * 5 + a.normal * 2 + a.suggestion;
      const scoreB = b.critical * 5 + b.normal * 2 + b.suggestion;
      return scoreB - scoreA;
    })
    .slice(0, 5);
}

function formatPiRunStatus(status: string): string {
  if (status === "completed") return "已完成";
  if (status === "running") return "运行中";
  if (status === "failed") return "失败";
  if (status === "cancelled") return "已停止";
  return status;
}

function formatCommentSources(comment: ReviewComment): string {
  const sourceProfiles = Array.isArray(comment.sourceProfilesJson)
    ? comment.sourceProfilesJson as Array<{ profileName?: string; model?: string; confidence?: number }>
    : [];

  if (sourceProfiles.length > 0) {
    return sourceProfiles
      .map((source) => {
        return `${source.profileName || "未知 Profile"} / ${source.model || "unknown"}`;
      })
      .join("；");
  }

  return `${comment.sourceProfileName || "默认 Pi Profile"} / ${comment.sourceProfileModel || "unknown"}`;
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
