/**
 * @file fetch-diff.ts
 * @description 审查步骤：获取 GitLab Diff
 *
 * 此步骤负责：
 * 1. 从数据库获取 ReviewLog 信息
 * 2. 根据 MR/Commit 类型调用 GitLab API 获取 diff
 * 3. 过滤并准备待审查的文件列表
 */

import { prisma } from "@/lib/prisma";
import type { ReviewState } from "../types";
import type { GitLabDiff, GitLabMergeRequest } from "@/lib/types";

/**
 * 获取 GitLab Diff
 */
export async function fetchDiffStep(state: ReviewState): Promise<Partial<ReviewState>> {
  console.log(`🔍 [FetchDiffStep] Starting review for log: ${state.reviewLogId}`);

  const reviewLog = await prisma.reviewLog.findUnique({
    where: { id: state.reviewLogId },
    include: {
      repository: {
        include: {
          gitLabAccount: true,
        },
      },
    },
  });

  if (!reviewLog) {
    console.error(`❌ [FetchDiffStep] Review log not found: ${state.reviewLogId}`);
    return {
      error: "Review log not found",
      completed: true,
    };
  }

  console.log(`📋 [FetchDiffStep] Review: ${reviewLog.title}`);
  console.log(
    `📂 [FetchDiffStep] Branch: ${reviewLog.sourceBranch} → ${reviewLog.targetBranch || "N/A"}`,
  );

  // 更新状态为 pending
  await prisma.reviewLog.update({
    where: { id: state.reviewLogId },
    data: { status: "pending" },
  });
  console.log(`🔄 [FetchDiffStep] Status updated to: pending`);

  const gitlabService = state.gitlabService;
  if (!gitlabService) {
    return {
      error: "GitLab service not initialized",
      completed: true,
    };
  }

  const isPushEvent = reviewLog.mergeRequestIid === 0;
  let mr: GitLabMergeRequest | null = null;
  let diffs: GitLabDiff[] = [];
  let reviewScope: "full" | "incremental" = "full";
  let incrementalBaseSha: string | null = null;

  if (isPushEvent) {
    console.log(
      `📌 [FetchDiffStep] Processing Push event for commit: ${reviewLog.commitSha}`,
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

    // 优先增量审查：仅审查“上次已审 commit -> 当前 commit”的新增变更
    const previousCompletedReview = await prisma.reviewLog.findFirst({
      where: {
        repositoryId: reviewLog.repositoryId,
        mergeRequestIid: reviewLog.mergeRequestIid,
        status: "completed",
        id: { not: reviewLog.id },
      },
      orderBy: { completedAt: "desc" },
      select: { commitSha: true },
    });

    if (previousCompletedReview?.commitSha && previousCompletedReview.commitSha !== reviewLog.commitSha) {
      try {
        const compareResult = await gitlabService.compareCommits(
          reviewLog.repository.gitLabProjectId,
          previousCompletedReview.commitSha,
          reviewLog.commitSha
        );

        if (Array.isArray(compareResult.diffs) && compareResult.diffs.length > 0) {
          reviewScope = "incremental";
          incrementalBaseSha = previousCompletedReview.commitSha;
          diffs = compareResult.diffs;
          console.log(`📌 [FetchDiffStep] Incremental review enabled: ${incrementalBaseSha} -> ${reviewLog.commitSha}, files=${diffs.length}`);
        }
      } catch (error) {
        console.warn(`⚠️ [FetchDiffStep] Incremental compare failed, fallback to full MR changes`, error);
      }
    }

    // 回退全量：没有可用增量基线或增量为空时，审查 MR 全量变更
    if (diffs.length === 0) {
      console.log(`📌 [FetchDiffStep] Fetching all changes for MR !${reviewLog.mergeRequestIid}`);
      diffs = await gitlabService.getMergeRequestChanges(
        reviewLog.repository.gitLabProjectId,
        reviewLog.mergeRequestIid,
      );
    }

    if (!diffs || diffs.length === 0) {
      console.log(`⏭️ [FetchDiffStep] No changes found in MR`);
      return {
        error: "No changes found in merge request",
        completed: true,
      };
    }

    console.log(`📌 [FetchDiffStep] Found ${diffs.length} files with changes in MR`);
  }

  const relevantDiffs = diffs.filter((diff) => !diff.deleted_file);

  console.log(`📁 [FetchDiffStep] Total files changed: ${relevantDiffs.length}`);

  // 更新文件总数
  await prisma.reviewLog.update({
    where: { id: state.reviewLogId },
    data: {
      totalFiles: relevantDiffs.length,
      reviewedFiles: 0,
    },
  });

  return {
    reviewLog,
    mrInfo: mr,
    diffs,
    relevantDiffs,
    reviewScope,
    incrementalBaseSha,
  };
}
