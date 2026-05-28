import { Prisma, type ReviewLog } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createGitLabService } from "@/lib/services/gitlab";
import { reviewService } from "@/lib/services/review";

type RepositoryWithGitLab = Prisma.RepositoryGetPayload<{
  include: { gitLabAccount: true };
}>;

type ReviewLogCreateResult = {
  reviewLog: ReviewLog;
  created: boolean;
};

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
          return this.createReviewLogOnce({
            unique: {
              repositoryId: repository.id,
              mergeRequestIid: mr.iid,
              commitSha,
            },
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
    }).then(({ reviewLog, created }) => {
      if (created) this.runAsync(reviewLog.id);
      return reviewLog;
    }).catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new Error("Review already exists");
      }
      throw error;
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

    return this.createReviewLogOnce({
      unique: {
        repositoryId: params.repository.id,
        mergeRequestIid: params.mergeRequest.iid,
        commitSha: params.commitSha,
      },
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
    }).then((result) => {
      if (!result.created) return result.reviewLog;
      return this.createMergeRequestPlaceholder(params.repository, result.reviewLog)
        .then(() => result.reviewLog)
        .catch((error) => {
          console.error("⚠️ [ReviewTriggerService] Failed to create MR placeholder:", error);
          return result.reviewLog;
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
    commitSha: string;
    authorName?: string | null;
    authorUsername?: string | null;
  }) {
    const authorUsername = params.authorUsername || "unknown";
    const author = params.authorName || authorUsername;

    return this.createReviewLogOnce({
      unique: {
        repositoryId: params.repository.id,
        mergeRequestIid: 0,
        commitSha: params.commitSha,
      },
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
        status: "pending",
        totalFiles: 0,
      },
    }).then((result) => {
      if (!result.created) return result.reviewLog;
      return this.createPushPlaceholder(params.repository, result.reviewLog)
        .then(() => result.reviewLog)
        .catch((error) => {
          console.error("⚠️ [ReviewTriggerService] Failed to create push placeholder:", error);
          return result.reviewLog;
        })
        .then((reviewLog) => {
          this.runAsync(reviewLog.id);
          return reviewLog;
        });
    });
  }

  retryReview(reviewId: string) {
    return prisma.$transaction((tx) => {
      return tx.reviewLog.updateMany({
        where: {
          id: reviewId,
          status: { not: "pending" },
        },
        data: {
          status: "pending",
          error: null,
          reviewedFiles: 0,
          criticalIssues: 0,
          normalIssues: 0,
          suggestions: 0,
          aiResponse: null,
          reviewPrompts: null,
          completedAt: null,
          gitlabDiscussionId: null,
          gitlabNoteId: null,
        },
      }).then((result) => {
        if (result.count === 0) {
          return tx.reviewLog.findUnique({ where: { id: reviewId } })
            .then((reviewLog) => {
              if (!reviewLog) throw new Error("Review log not found");
              throw new Error("Review is already in progress");
            });
        }

        return Promise.all([
          tx.reviewComment.deleteMany({ where: { reviewLogId: reviewId } }),
          tx.reviewAgentTrace.deleteMany({ where: { reviewLogId: reviewId } }),
          tx.reviewLog.findUniqueOrThrow({ where: { id: reviewId } }),
        ]).then(([, , updated]) => updated);
      });
    }).then((reviewLog) => {
      this.runAsync(reviewLog.id);
      return reviewLog;
    });
  }

  private createReviewLogOnce(params: {
    unique: {
      repositoryId: string;
      mergeRequestIid: number;
      commitSha: string;
    };
    data: Prisma.ReviewLogUncheckedCreateInput;
  }): Promise<ReviewLogCreateResult> {
    return prisma.reviewLog.create({ data: params.data })
      .then((reviewLog) => ({ reviewLog, created: true }))
      .catch((error) => {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
          throw error;
        }

        return prisma.reviewLog.findUnique({
          where: {
            repositoryId_mergeRequestIid_commitSha: params.unique,
          },
        }).then((reviewLog) => {
          if (!reviewLog) throw error;
          return { reviewLog, created: false };
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
      console.error("❌ [ReviewTriggerService] Review failed:", error);
    });
  }
}

export const reviewTriggerService = new ReviewTriggerService();
