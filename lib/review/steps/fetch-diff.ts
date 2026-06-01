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

function isValidCompareBaseSha(sha: string | null | undefined): sha is string {
  return Boolean(sha && !/^0+$/.test(sha));
}

function readPushCommitShas(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
}

function mergeDiffsByFile(diffs: GitLabDiff[]): GitLabDiff[] {
  const map = new Map<string, GitLabDiff>();

  diffs.forEach((diff) => {
    const key = diff.new_path || diff.old_path;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, diff);
      return;
    }

    map.set(key, {
      ...diff,
      diff: [existing.diff, diff.diff].filter(Boolean).join("\n\n"),
      deleted_file: existing.deleted_file && diff.deleted_file,
      new_file: existing.new_file || diff.new_file,
      renamed_file: existing.renamed_file || diff.renamed_file,
    });
  });

  return [...map.values()];
}

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
      `📌 [FetchDiffStep] Processing Push event: ${reviewLog.baseCommitSha || "N/A"} -> ${reviewLog.commitSha}`,
    );
    if (isValidCompareBaseSha(reviewLog.baseCommitSha) && reviewLog.baseCommitSha !== reviewLog.commitSha) {
      try {
        const compareResult = await gitlabService.compareCommits(
          reviewLog.repository.gitLabProjectId,
          reviewLog.baseCommitSha,
          reviewLog.commitSha,
        );
        diffs = compareResult.diffs || [];
        reviewScope = "incremental";
        incrementalBaseSha = reviewLog.baseCommitSha;
        console.log(`📌 [FetchDiffStep] Push range diff enabled: ${incrementalBaseSha} -> ${reviewLog.commitSha}, files=${diffs.length}`);
      } catch (error) {
        console.warn(`⚠️ [FetchDiffStep] Push range compare failed, fallback to head commit diff`, error);
      }
    }

    if (diffs.length === 0) {
      const pushCommitShas = readPushCommitShas(reviewLog.pushCommitShasJson);
      if (pushCommitShas.length > 0) {
        console.log(`📌 [FetchDiffStep] Fetching push commit diffs, commits=${pushCommitShas.length}`);
        const commitDiffGroups = await Promise.all(
          pushCommitShas.map((sha) => gitlabService.getCommitDiff(reviewLog.repository.gitLabProjectId, sha)),
        );
        diffs = commitDiffGroups.flat();
      }
    }

    if (diffs.length === 0) {
      console.log(`📌 [FetchDiffStep] Fallback to head commit diff: ${reviewLog.commitSha}`);
      diffs = await gitlabService.getCommitDiff(reviewLog.repository.gitLabProjectId, reviewLog.commitSha);
    }
  } else {
    mr = await gitlabService.getMergeRequest(
      reviewLog.repository.gitLabProjectId,
      reviewLog.mergeRequestIid,
    );

    console.log(`📌 [FetchDiffStep] Fetching all changes for MR !${reviewLog.mergeRequestIid}`);
    diffs = await gitlabService.getMergeRequestChanges(
      reviewLog.repository.gitLabProjectId,
      reviewLog.mergeRequestIid,
    );

    if (!diffs || diffs.length === 0) {
      console.log(`⏭️ [FetchDiffStep] No changes found in MR`);
      return {
        error: "No changes found in merge request",
        completed: true,
      };
    }

    console.log(`📌 [FetchDiffStep] Found ${diffs.length} files with changes in MR`);
  }

  diffs = mergeDiffsByFile(diffs);
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
