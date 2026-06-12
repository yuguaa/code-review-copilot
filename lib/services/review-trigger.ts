import { Prisma, type ReviewLog } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createGitLabService } from "@/lib/services/gitlab";
import { interruptRunningPiCommand } from "@/lib/services/pi-runtime-command-registry";
import { reviewService } from "@/lib/services/review";
import { REVIEW_CANCELLED_STATUS } from "@/lib/services/review-cancellation";
import { reviewWorkflowRecorder } from "@/lib/services/review-workflow-recorder";
import { createLogger, logError } from "@/lib/logger";

const log = createLogger("ReviewTriggerService");

type RepositoryWithGitLab = Prisma.RepositoryGetPayload<{
  include: { gitLabAccount: true };
}>;

export class ReviewTriggerService {
  private createTriggerNode(reviewLog: ReviewLog, trigger: string, detail: string) {
    return reviewWorkflowRecorder.upsertNode({
      reviewLogId: reviewLog.id,
      nodeKey: "trigger",
      kind: "trigger",
      status: "success",
      title: `${trigger} 触发审查`,
      summary: reviewLog.mergeRequestIid === 0
        ? `Push ${reviewLog.commitShortId}`
        : `MR !${reviewLog.mergeRequestIid} · ${reviewLog.commitShortId}`,
      detail,
      sequence: 10,
      metrics: {
        repositoryId: reviewLog.repositoryId,
        mergeRequestIid: reviewLog.mergeRequestIid,
        commitSha: reviewLog.commitSha,
        sourceBranch: reviewLog.sourceBranch,
        targetBranch: reviewLog.targetBranch,
        author: reviewLog.author,
      },
      raw: {
        title: reviewLog.title,
        description: reviewLog.description,
      },
    }).then(() => reviewLog);
  }

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
      return this.createTriggerNode(
        reviewLog,
        "Manual",
        `手动触发 MR !${reviewLog.mergeRequestIid} 审查`,
      );
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
      return this.createTriggerNode(
        reviewLog,
        "Merge Request",
        `GitLab MR webhook 触发：${reviewLog.sourceBranch} -> ${reviewLog.targetBranch}`,
      );
    }).then((reviewLog) => {
      this.runAsync(reviewLog.id);
      return reviewLog;
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
      return this.createTriggerNode(
        reviewLog,
        "Push",
        `GitLab Push webhook 触发：${reviewLog.sourceBranch} @ ${reviewLog.commitShortId}`,
      );
    }).then((reviewLog) => {
      this.runAsync(reviewLog.id);
      return reviewLog;
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
        return this.createTriggerNode(
          reviewLog,
          "Retry",
          `重新触发审查，来源 Log ${reviewId.slice(0, 8)}`,
        );
      });
    }).then((reviewLog) => {
      this.runAsync(reviewLog.id);
      return reviewLog;
    });
  }

  stopReview(reviewId: string) {
    const stoppedAt = new Date();
    let shouldInterruptRuntime = false;

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
              if (reviewLog.status === REVIEW_CANCELLED_STATUS) {
                shouldInterruptRuntime = true;
                return reviewLog;
              }
              throw new Error("Only pending reviews can be stopped");
            });
        }

        shouldInterruptRuntime = true;
        return Promise.all([
          tx.piReviewRun.updateMany({
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
          tx.reviewSandboxSession.updateMany({
            where: {
              reviewLogId: reviewId,
              status: "running",
            },
            data: {
              status: "cancelling",
              error: "手动停止",
            },
          }),
          tx.reviewLog.findUniqueOrThrow({ where: { id: reviewId } }),
        ]).then(([, , reviewLog]) => reviewLog);
      });
    }).then((reviewLog) => {
      const interruptPromise = shouldInterruptRuntime
        ? interruptRunningPiCommand(reviewId)
        : Promise.resolve();

      return interruptPromise
        .catch((error) => {
          logError(log, error, "⚠️ [ReviewTriggerService] Failed to stop running Pi command:");
        })
        .then(() => reviewWorkflowRecorder.cancelRunningNodes(reviewId))
        .catch((error) => {
          logError(log, error, "⚠️ [ReviewTriggerService] Failed to cancel workflow nodes:");
        })
        .then(() => reviewLog);
    });
  }

  runAsync(reviewLogId: string) {
    reviewService.performReview(reviewLogId).catch((error) => {
      logError(log, error, "❌ [ReviewTriggerService] Review failed:");
    });
  }
}

export const reviewTriggerService = new ReviewTriggerService();
