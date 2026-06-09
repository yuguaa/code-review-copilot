import { Prisma, type ReviewLog } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createGitLabService } from "@/lib/services/gitlab";
import { reviewService } from "@/lib/services/review";
import { REVIEW_CANCELLED_STATUS } from "@/lib/services/review-cancellation";
import { createLogger, logError } from "@/lib/logger";

const log = createLogger("ReviewTriggerService");

type RepositoryWithGitLab = Prisma.RepositoryGetPayload<{
  include: { gitLabAccount: true };
}>;

export class ReviewTriggerService {
  startManualReview(params: { repositoryId: string; mergeRequestIid: number }) {
    return prisma.repository.findUnique({
      where: { id: params.repositoryId },
      include: { gitLabAccount: true },
    }).then((repository) => {
      if (!repository) {
        throw new Error("Repository not found");
      }

      const gitlabService = createGitLabService(
        repository.gitLabAccount.url,
        repository.gitLabAccount.accessToken,
      );

      return gitlabService.getMergeRequest(repository.gitLabProjectId, params.mergeRequestIid)
        .then((mr) => {
          const commitSha = mr.diff_refs.head_sha;
          return prisma.reviewLog.create({
            data: {
              repositoryId: repository.id,
              mergeRequestId: mr.id,
              mergeRequestIid: mr.iid,
              sourceBranch: mr.source_branch,
              targetBranch: mr.target_branch,
              author: mr.author?.name || mr.author?.username || "unknown",
              authorUsername: mr.author?.username,
              title: mr.title,
              description: mr.description,
              commitSha,
              commitShortId: commitSha.substring(0, 8),
              status: "pending",
              totalFiles: 0,
            },
          });
        });
    }).then((reviewLog) => {
      this.runAsync(reviewLog.id);
      return reviewLog;
    });
  }

  startWebhookMergeRequestReview(params: {
    repository: RepositoryWithGitLab;
    mergeRequest: {
      id: number;
      iid: number;
      source_branch: string;
      target_branch: string;
      title: string;
      description?: string | null;
    };
    commitSha: string;
    authorName?: string | null;
    authorUsername?: string | null;
  }) {
    const authorUsername = params.authorUsername || "unknown";
    const author = params.authorName || authorUsername;

    return prisma.reviewLog.create({
      data: {
        repositoryId: params.repository.id,
        mergeRequestId: params.mergeRequest.id,
        mergeRequestIid: params.mergeRequest.iid,
        sourceBranch: params.mergeRequest.source_branch,
        targetBranch: params.mergeRequest.target_branch,
        author,
        authorUsername,
        title: params.mergeRequest.title,
        description: params.mergeRequest.description,
        commitSha: params.commitSha,
        commitShortId: params.commitSha.substring(0, 8),
        status: "pending",
        totalFiles: 0,
      },
    }).then((reviewLog) => {
      return this.createMergeRequestPlaceholder(params.repository, reviewLog)
        .then(() => reviewLog)
        .catch((error) => {
          logError(log, error, "⚠️ [ReviewTriggerService] Failed to create MR placeholder:");
          return reviewLog;
        })
        .then((reviewLog) => {
          this.runAsync(reviewLog.id);
          return reviewLog;
        });
    });
  }

  startWebhookPushReview(params: {
    repository: RepositoryWithGitLab;
    branchName: string;
    baseCommitSha?: string | null;
    pushCommitShas?: string[];
    commitSha: string;
    authorName?: string | null;
    authorUsername?: string | null;
  }) {
    const authorUsername = params.authorUsername || "unknown";
    const author = params.authorName || authorUsername;

    return prisma.reviewLog.create({
      data: {
        repositoryId: params.repository.id,
        mergeRequestId: 0,
        mergeRequestIid: 0,
        sourceBranch: params.branchName,
        targetBranch: "",
        author,
        authorUsername,
        title: `Push to ${params.branchName}`,
        description: null,
        commitSha: params.commitSha,
        commitShortId: params.commitSha.substring(0, 8),
        baseCommitSha: params.baseCommitSha || null,
        pushCommitShasJson: params.pushCommitShas || [],
        status: "pending",
        totalFiles: 0,
      },
    }).then((reviewLog) => {
      return this.createPushPlaceholder(params.repository, reviewLog)
        .then(() => reviewLog)
        .catch((error) => {
          logError(log, error, "⚠️ [ReviewTriggerService] Failed to create push placeholder:");
          return reviewLog;
        })
        .then((reviewLog) => {
          this.runAsync(reviewLog.id);
          return reviewLog;
        });
    });
  }

  retryReview(reviewId: string) {
    return prisma.reviewLog.findUnique({
      where: { id: reviewId },
      include: {
        repository: {
          include: {
            gitLabAccount: true,
          },
        },
      },
    }).then((sourceReview) => {
      if (!sourceReview) throw new Error("Review log not found");
      if (sourceReview.status === "pending") {
        throw new Error("Review is already in progress");
      }

      return prisma.reviewLog.create({
        data: {
          repositoryId: sourceReview.repositoryId,
          mergeRequestId: sourceReview.mergeRequestId,
          mergeRequestIid: sourceReview.mergeRequestIid,
          sourceBranch: sourceReview.sourceBranch,
          targetBranch: sourceReview.targetBranch,
          author: sourceReview.author,
          authorUsername: sourceReview.authorUsername,
          title: sourceReview.title,
          description: sourceReview.description,
          commitSha: sourceReview.commitSha,
          commitShortId: sourceReview.commitShortId,
          baseCommitSha: sourceReview.baseCommitSha,
          pushCommitShasJson: sourceReview.pushCommitShasJson || [],
          status: "pending",
          totalFiles: 0,
        },
      }).then((reviewLog) => {
        const placeholderPromise = reviewLog.mergeRequestIid === 0
          ? this.createPushPlaceholder(sourceReview.repository, reviewLog)
          : this.createMergeRequestPlaceholder(sourceReview.repository, reviewLog);

        return placeholderPromise
          .catch((error) => {
            logError(log, error, "⚠️ [ReviewTriggerService] Failed to create retry placeholder:");
            return reviewLog;
          });
      });
    }).then((reviewLog) => {
      this.runAsync(reviewLog.id);
      return reviewLog;
    });
  }

  stopReview(reviewId: string) {
    const stoppedAt = new Date();

    return prisma.$transaction((tx) => {
      return tx.reviewLog.updateMany({
        where: {
          id: reviewId,
          status: "pending",
        },
        data: {
          status: REVIEW_CANCELLED_STATUS,
          error: "手动停止",
          completedAt: stoppedAt,
        },
      }).then((result) => {
        if (result.count === 0) {
          return tx.reviewLog.findUnique({ where: { id: reviewId } })
            .then((reviewLog) => {
              if (!reviewLog) throw new Error("Review log not found");
              if (reviewLog.status === REVIEW_CANCELLED_STATUS) return reviewLog;
              throw new Error("Only pending reviews can be stopped");
            });
        }

        return Promise.all([
          tx.reviewBotRun.updateMany({
            where: {
              reviewLogId: reviewId,
              status: { in: ["pending", "running"] },
            },
            data: {
              status: REVIEW_CANCELLED_STATUS,
              error: "手动停止",
              completedAt: stoppedAt,
            },
          }),
          tx.reviewLog.findUniqueOrThrow({ where: { id: reviewId } }),
        ]).then(([, reviewLog]) => reviewLog);
      });
    });
  }

  private createMergeRequestPlaceholder(repository: RepositoryWithGitLab, reviewLog: ReviewLog) {
    const gitlabService = createGitLabService(
      repository.gitLabAccount.url,
      repository.gitLabAccount.accessToken,
    );
    const placeholderBody = `## 🔄 Code Review in Progress...\n\n正在进行代码审查，请稍候...\n\n- 📂 正在分析代码变更\n- 🤖 AI 正在审查中\n\n<sub>⏱️ 开始时间: ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</sub>`;

    return gitlabService.createMergeRequestComment(
      repository.gitLabProjectId,
      reviewLog.mergeRequestIid,
      placeholderBody,
    ).then((placeholderResult) => {
      const discussionId = String(placeholderResult.id);
      const firstNoteId = placeholderResult.notes?.[0]?.id;
      const noteId = Number.isInteger(firstNoteId)
        ? firstNoteId
        : null;

      return prisma.reviewLog.update({
        where: { id: reviewLog.id },
        data: {
          gitlabDiscussionId: discussionId,
          gitlabNoteId: noteId,
        },
      });
    });
  }

  private createPushPlaceholder(repository: RepositoryWithGitLab, reviewLog: ReviewLog) {
    const gitlabService = createGitLabService(
      repository.gitLabAccount.url,
      repository.gitLabAccount.accessToken,
    );
    const pushMarker = `CRC_PUSH_PLACEHOLDER:${reviewLog.id}`;
    const placeholderBody = `## 🔄 Code Review in Progress...\n\n正在进行代码审查，请稍候...\n\n- 📂 正在分析代码变更\n- 🤖 AI 正在审查中\n\n<!-- ${pushMarker} -->\n<sub>⏱️ 开始时间: ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</sub>`;

    return gitlabService.createCommitComment(
      repository.gitLabProjectId,
      reviewLog.commitSha,
      placeholderBody,
    ).then((placeholderResult) => {
      const rawNoteId = Number.isInteger(placeholderResult?.note_id)
        ? placeholderResult.note_id
        : (Number.isInteger(placeholderResult?.id) ? placeholderResult.id : null);
      const noteId = typeof rawNoteId === "number" ? rawNoteId : null;

      return prisma.reviewLog.update({
        where: { id: reviewLog.id },
        data: {
          gitlabDiscussionId: pushMarker,
          gitlabNoteId: noteId,
        },
      });
    });
  }

  runAsync(reviewLogId: string) {
    reviewService.performReview(reviewLogId).catch((error) => {
      logError(log, error, "❌ [ReviewTriggerService] Review failed:");
    });
  }
}

export const reviewTriggerService = new ReviewTriggerService();
