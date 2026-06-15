/**
 * @file publish-comment.ts
 * @description 审查终态通知：发布 GitLab 总评并发送钉钉通知。
 */

import type { ReviewComment, ReviewLog } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ReviewState } from "@/lib/review/types";
import { sendReviewToDingTalk } from "@/lib/services/dingtalk";
import { REVIEW_CANCELLED_STATUS, ReviewCancelledError } from "@/lib/services/review-cancellation";
import { createLogger, logError, logWarn } from "@/lib/logger";

const log = createLogger("PublishCommentStep");

type PiRunForSummary = {
  status: string;
  summary: string | null;
  modelName: string;
  piProfile: { name: string } | null;
};

type ReviewTerminalStatus = "completed" | "failed" | "cancelled";

type ReviewNotificationLog = ReviewLog & {
  repository: {
    name: string;
    path: string;
    gitLabProjectId: number;
    gitLabAccount: {
      url: string;
    };
  };
  comments: ReviewComment[];
  piRuns: PiRunForSummary[];
};

type ReviewNotificationContext = {
  reviewLog: ReviewNotificationLog;
  message: string;
  title: string;
  status: ReviewTerminalStatus;
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

function loadReviewNotificationLog(reviewLogId: string): Promise<ReviewNotificationLog | null> {
  return prisma.reviewLog.findUnique({
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
      piRuns: {
        orderBy: { startedAt: "asc" },
        include: {
          piProfile: { select: { name: true } },
        },
      },
    },
  });
}

function buildReviewNotificationContext(
  state: ReviewState,
  reviewLog: ReviewNotificationLog,
  status: ReviewTerminalStatus,
  error?: unknown,
): ReviewNotificationContext {
  const title = status === "completed"
    ? "Code Review 完成"
    : status === "cancelled"
      ? "Code Review 已停止"
      : "Code Review 失败";
  const message = status === "completed"
    ? formatSummaryComment(
      reviewLog,
      state.summary || "",
      state.fileResults,
      reviewLog.comments,
      reviewLog.piRuns,
      state.reviewScope,
      state.incrementalBaseSha,
    )
    : formatUnfinishedComment(
      reviewLog,
      state.summary || "",
      reviewLog.piRuns,
      state.reviewScope,
      state.incrementalBaseSha,
      status,
      error,
    );

  return { reviewLog, message, title, status };
}

function publishGitLabReviewNotification(
  state: ReviewState,
  context: ReviewNotificationContext,
): Promise<string | null> {
  const gitlabService = state.gitlabService;
  if (!gitlabService) {
    return Promise.resolve("GitLab service not initialized");
  }

  const reviewLog = context.reviewLog;
  const projectId = reviewLog.repository.gitLabProjectId;
  const isPushEvent = reviewLog.mergeRequestIid === 0;
  const publish = isPushEvent
    ? gitlabService.createCommitComment(projectId, reviewLog.commitSha, context.message)
      .then((result) => ({
        discussionId: null,
        noteId: readGitLabNoteId(result),
        commentId: readGitLabCommentId(result),
      }))
    : gitlabService.createMergeRequestComment(projectId, reviewLog.mergeRequestIid, context.message)
      .then((result) => ({
        discussionId: String(result.id),
        noteId: result.notes?.[0]?.id || null,
        commentId: String(result.id),
      }));

  return publish.then((result) => {
    const writeReviewLog = prisma.reviewLog.update({
      where: { id: state.reviewLogId },
      data: {
        gitlabDiscussionId: result.discussionId,
        gitlabNoteId: result.noteId,
      },
    });

    const writes: Array<Promise<unknown>> = [writeReviewLog];
    if (context.status === "completed") {
      writes.push(prisma.reviewComment.updateMany({
        where: { reviewLogId: state.reviewLogId, isPosted: false },
        data: {
          isPosted: true,
          gitlabCommentId: result.commentId,
        },
      }));
    }

    return Promise.all(writes).then(() => null);
  }).catch((error) => {
    logError(log, error, "❌ [PublishCommentStep] Failed to publish GitLab notification");
    return error instanceof Error ? error.message : "Failed to publish GitLab notification";
  });
}

function publishDingTalkReviewNotification(context: ReviewNotificationContext): Promise<void> {
  const reviewLog = context.reviewLog;
  return sendReviewToDingTalk({
    reviewLog,
    repositoryName: reviewLog.repository.name,
    repositoryPath: reviewLog.repository.path,
    gitlabUrl: reviewLog.repository.gitLabAccount.url,
    title: context.title,
    messageOverride: context.message,
  }).catch((error) => {
    logWarn(log, error, "⚠️ [PublishCommentStep] Failed to send DingTalk notification");
  });
}

function readGitLabNoteId(result: { id?: number | string; note_id?: number; notes?: Array<{ id: number }> }): number | null {
  if (typeof result.note_id === "number" && Number.isInteger(result.note_id)) return result.note_id;
  if (typeof result.id === "number" && Number.isInteger(result.id)) return result.id;
  const firstNoteId = result.notes?.[0]?.id;
  return typeof firstNoteId === "number" && Number.isInteger(firstNoteId) ? firstNoteId : null;
}

function readGitLabCommentId(result: { id?: number | string; note_id?: number; notes?: Array<{ id: number }> }): string | null {
  if (result.id !== undefined && result.id !== null) return String(result.id);
  if (result.note_id !== undefined && result.note_id !== null) return String(result.note_id);
  return null;
}

export function publishReviewTerminalFailureNotification(
  state: ReviewState,
  status: Exclude<ReviewTerminalStatus, "completed">,
  error?: unknown,
): Promise<void> {
  return loadReviewNotificationLog(state.reviewLogId).then((reviewLog) => {
    if (!reviewLog) {
      log.warn(`⚠️ [PublishCommentStep] Review log not found for terminal notification: ${state.reviewLogId}`);
      return;
    }

    const context = buildReviewNotificationContext(state, reviewLog, status, error);
    return publishGitLabReviewNotification(state, context)
      .then(() => publishDingTalkReviewNotification(context));
  }).catch((notifyError) => {
    logWarn(log, notifyError, "⚠️ [PublishCommentStep] Failed to publish terminal notification");
  });
}

/**
 * 发布成功终态通知。
 */
export function publishCommentStep(state: ReviewState): Promise<Partial<ReviewState>> {
  log.info("💬 [PublishCommentStep] Publishing final review notification");

  return loadReviewNotificationLog(state.reviewLogId).then((reviewLog) => {
    if (!reviewLog) {
      return {
        completed: true,
        error: "Review log not found",
      };
    }

    const context = buildReviewNotificationContext(state, reviewLog, "completed");
    return publishGitLabReviewNotification(state, context).then((publishError) => {
      if (publishError) {
        return {
          completed: true,
          error: publishError,
        };
      }

      return markReviewCompleted(state.reviewLogId)
        .then(() => publishDingTalkReviewNotification(context))
        .then(() => ({
          completed: true,
          error: null,
        }));
    });
  });
}

function formatSummaryComment(
  reviewLog: ReviewLog,
  summary: string,
  fileResults: Array<{ filePath: string; counts: { critical: number; normal: number; suggestion: number } }>,
  postedComments: ReviewComment[],
  piRuns: PiRunForSummary[],
  reviewScope: "full" | "incremental",
  incrementalBaseSha: string | null,
): string {
  const lines: string[] = [];
  const sortedComments = [...postedComments].sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity));
  const criticalComments = sortedComments.filter((item) => item.severity === "critical");
  const normalComments = sortedComments.filter((item) => item.severity === "normal");
  const suggestionComments = sortedComments.filter((item) => item.severity === "suggestion");
  const critical = criticalComments.length;
  const normal = normalComments.length;
  const suggestion = suggestionComments.length;
  const totalFiles = reviewLog.totalFiles ?? 0;
  const reviewedFiles = reviewLog.reviewedFiles ?? 0;
  const filesWithIssues = fileResults.filter(
    (file) => file.counts.critical > 0 || file.counts.normal > 0 || file.counts.suggestion > 0,
  ).length;
  const reviewResult = getReviewConclusion(critical, normal, suggestion);
  const topFiles = buildFileRiskRank(sortedComments);

  lines.push("## 🤖 Code Review Copilot");
  lines.push("");
  lines.push(`> **结论：${reviewResult}**`);
  lines.push("");
  pushScopeLines(lines, reviewLog, reviewScope, incrementalBaseSha);
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
      const location = formatCommentLocation(comment);
      lines.push(`- \`${location}\` (${comment.severity === "critical" ? "严重" : "一般"})`);
    });
  }
  lines.push("");
  lines.push(`Nitpick comments: **${nitpickCount}**`);
  if (nitpickCount === 0) {
    lines.push("- 无 nitpick。");
  } else {
    suggestionComments.forEach((comment) => {
      lines.push(`- \`${formatCommentLocation(comment)}\``);
    });
  }

  lines.push("");
  lines.push("### 全部问题清单");
  if (sortedComments.length === 0) {
    lines.push("- 本次无可定位问题。");
  } else {
    sortedComments.forEach((comment, index) => {
      const finding = parseStructuredFinding(comment.content);
      const tag = comment.severity === "critical" ? "严重" : comment.severity === "normal" ? "一般" : "建议";

      lines.push(`${index + 1}. [${tag}] \`${formatCommentLocation(comment)}\``);
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

  pushPiRunLines(lines, piRuns);

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
  lines.push(`<sub>完成时间：${formatShanghaiTime(new Date())}</sub>`);

  return lines.join("\n");
}

function formatUnfinishedComment(
  reviewLog: ReviewLog,
  summary: string,
  piRuns: PiRunForSummary[],
  reviewScope: "full" | "incremental",
  incrementalBaseSha: string | null,
  status: Exclude<ReviewTerminalStatus, "completed">,
  error?: unknown,
): string {
  const title = status === "cancelled" ? "已停止" : "失败";
  const lines = [
    "## 🤖 Code Review Copilot",
    "",
    `> **结论：审查${title}**`,
    "",
  ];

  pushScopeLines(lines, reviewLog, reviewScope, incrementalBaseSha);
  lines.push(`- 审查文件：${reviewLog.reviewedFiles ?? 0}/${reviewLog.totalFiles ?? 0}`);
  const reason = status === "cancelled"
    ? reviewLog.error || "手动停止"
    : error || reviewLog.error || "未知错误";
  lines.push(`- ${status === "cancelled" ? "停止原因" : "失败原因"}：${errorToMessage(reason)}`);

  if (summary) {
    lines.push("");
    lines.push("### 已生成摘要");
    lines.push(stripSummaryHeading(summary));
  }

  pushPiRunLines(lines, piRuns);
  lines.push("");
  lines.push("### 后续处理");
  if (status === "cancelled") {
    lines.push("1. 审查已停止，不再继续运行 Pi。");
    lines.push("2. 如需重新审查，请使用 Retry 重新触发。");
  } else {
    lines.push("1. 先查看失败原因和 Pi Runtime 记录。");
    lines.push("2. 修复配置、GitLab、Bubblewrap 或 Pi 输出问题后重新触发。");
  }
  lines.push("");
  lines.push(`<sub>结束时间：${formatShanghaiTime(new Date())}</sub>`);

  return lines.join("\n");
}

function pushScopeLines(
  lines: string[],
  reviewLog: ReviewLog,
  reviewScope: "full" | "incremental",
  incrementalBaseSha: string | null,
): void {
  lines.push("### 概览");
  if (reviewScope === "incremental") {
    lines.push(`- 审查模式：Push 范围审查（${shortSha(incrementalBaseSha)} -> ${shortSha(reviewLog.commitSha)} 的完整变更）`);
  } else {
    lines.push("- 审查模式：全量审查（当前 MR/Commit 完整变更）");
  }
}

function pushPiRunLines(lines: string[], piRuns: PiRunForSummary[]): void {
  lines.push("");
  lines.push("### Pi Profile 结果");
  if (piRuns.length === 0) {
    lines.push("- 未记录 Pi Profile 执行结果。");
    return;
  }

  piRuns.forEach((piRun) => {
    const profileName = piRun.piProfile?.name || "未知 Profile";
    lines.push(`- **${profileName}** / \`${piRun.modelName}\`：${formatPiRunStatus(piRun.status)}${piRun.summary ? `，${piRun.summary}` : ""}`);
  });
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

function formatCommentLocation(comment: ReviewComment): string {
  return comment.lineRangeEnd
    ? `${comment.filePath}:${comment.lineNumber}-${comment.lineRangeEnd}`
    : `${comment.filePath}:${comment.lineNumber}`;
}

function formatCommentSources(comment: ReviewComment): string {
  const sourceProfiles = Array.isArray(comment.sourceProfilesJson)
    ? comment.sourceProfilesJson as Array<{ profileName?: string; model?: string; confidence?: number }>
    : [];

  if (sourceProfiles.length > 0) {
    return sourceProfiles
      .map((source) => `${source.profileName || "未知 Profile"} / ${source.model || "unknown"}`)
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

  return {
    issue: issue || clean,
    impact: impact || "可能引入功能错误、稳定性或可维护性风险。",
    suggestion: suggestion || "请按该点修复并补充必要回归验证。",
  };
}

function severityWeight(severity: string): number {
  if (severity === "critical") return 3;
  if (severity === "normal") return 2;
  return 1;
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" && error.trim() ? error.trim() : "未知错误";
}

function formatShanghaiTime(value: Date): string {
  return value.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

function shortSha(sha: string | null | undefined): string {
  if (!sha) return "unknown";
  return sha.slice(0, 8);
}
