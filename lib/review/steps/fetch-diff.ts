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
import { getReviewableDiffs } from "@/lib/review/finding-validation";
import type { ReviewState } from "../types";
import type { GitLabDiff, GitLabMergeRequest } from "@/lib/types";
import { createLogger, logWarn } from "@/lib/logger";

const log = createLogger("FetchDiffStep");

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

function loadReviewLog(state: ReviewState) {
  if (state.reviewLog) return Promise.resolve(state.reviewLog);
  return prisma.reviewLog.findUnique({
    where: { id: state.reviewLogId },
    include: {
      repository: {
        include: {
          gitLabAccount: true,
        },
      },
    },
  });
}

function fetchPushDiffs(
  state: ReviewState,
  reviewLog: NonNullable<ReviewState["reviewLog"]>,
): Promise<{
  mr: GitLabMergeRequest | null;
  diffs: GitLabDiff[];
  reviewScope: "full" | "incremental";
  incrementalBaseSha: string | null;
}> {
  const gitlabService = state.gitlabService;
  if (!gitlabService) return Promise.reject(new Error("GitLab service not initialized"));

  log.info(
    `📌 [FetchDiffStep] Processing Push event: ${reviewLog.baseCommitSha || "N/A"} -> ${reviewLog.commitSha}`,
  );

  const fetchRange = isValidCompareBaseSha(reviewLog.baseCommitSha) && reviewLog.baseCommitSha !== reviewLog.commitSha
    ? gitlabService.compareCommits(
      reviewLog.repository.gitLabProjectId,
      reviewLog.baseCommitSha,
      reviewLog.commitSha,
    ).then((compareResult) => ({
      diffs: compareResult.diffs || [],
      reviewScope: "incremental" as const,
      incrementalBaseSha: reviewLog.baseCommitSha,
    })).catch((error) => {
      logWarn(log, error, "⚠️ [FetchDiffStep] Push range compare failed, fallback to head commit diff");
      return {
        diffs: [],
        reviewScope: "full" as const,
        incrementalBaseSha: null,
      };
    })
    : Promise.resolve({
      diffs: [],
      reviewScope: "full" as const,
      incrementalBaseSha: null,
    });

  return fetchRange.then((rangeResult) => {
    if (rangeResult.diffs.length > 0) {
      log.info(`📌 [FetchDiffStep] Push range diff enabled: ${rangeResult.incrementalBaseSha} -> ${reviewLog.commitSha}, files=${rangeResult.diffs.length}`);
      return rangeResult;
    }

    const pushCommitShas = readPushCommitShas(reviewLog.pushCommitShasJson);
    if (pushCommitShas.length === 0) return rangeResult;

    log.info(`📌 [FetchDiffStep] Fetching push commit diffs, commits=${pushCommitShas.length}`);
    return Promise.all(
      pushCommitShas.map((sha) => gitlabService.getCommitDiff(reviewLog.repository.gitLabProjectId, sha)),
    ).then((commitDiffGroups) => ({
      ...rangeResult,
      diffs: commitDiffGroups.flat(),
    }));
  }).then((result) => {
    if (result.diffs.length > 0) {
      return {
        mr: null,
        diffs: result.diffs,
        reviewScope: result.reviewScope,
        incrementalBaseSha: result.incrementalBaseSha,
      };
    }

    log.info(`📌 [FetchDiffStep] Fallback to head commit diff: ${reviewLog.commitSha}`);
    return gitlabService.getCommitDiff(reviewLog.repository.gitLabProjectId, reviewLog.commitSha)
      .then((diffs) => ({
        mr: null,
        diffs,
        reviewScope: result.reviewScope,
        incrementalBaseSha: result.incrementalBaseSha,
      }));
  });
}

function fetchMergeRequestDiffs(
  state: ReviewState,
  reviewLog: NonNullable<ReviewState["reviewLog"]>,
): Promise<{
  mr: GitLabMergeRequest | null;
  diffs: GitLabDiff[];
  reviewScope: "full" | "incremental";
  incrementalBaseSha: string | null;
}> {
  const gitlabService = state.gitlabService;
  if (!gitlabService) return Promise.reject(new Error("GitLab service not initialized"));

  return gitlabService.getMergeRequest(
    reviewLog.repository.gitLabProjectId,
    reviewLog.mergeRequestIid,
  ).then((mr) => {
    log.info(`📌 [FetchDiffStep] Fetching all changes for MR !${reviewLog.mergeRequestIid}`);
    return gitlabService.getMergeRequestChanges(
      reviewLog.repository.gitLabProjectId,
      reviewLog.mergeRequestIid,
    ).then((diffs) => {
      if (!diffs || diffs.length === 0) {
        log.info(`⏭️ [FetchDiffStep] No changes found in MR`);
        throw new Error("No changes found in merge request");
      }

      log.info(`📌 [FetchDiffStep] Found ${diffs.length} files with changes in MR`);
      return {
        mr,
        diffs,
        reviewScope: "full" as const,
        incrementalBaseSha: null,
      };
    });
  });
}

/**
 * 获取 GitLab Diff
 */
export function fetchDiffStep(state: ReviewState): Promise<Partial<ReviewState>> {
  log.info(`🔍 [FetchDiffStep] Starting review for log: ${state.reviewLogId}`);

  return loadReviewLog(state).then((reviewLog) => {
  if (!reviewLog) {
    log.error(`❌ [FetchDiffStep] Review log not found: ${state.reviewLogId}`);
      throw new Error("Review log not found");
  }

  log.info(`📋 [FetchDiffStep] Review: ${reviewLog.title}`);
  log.info(
    `📂 [FetchDiffStep] Branch: ${reviewLog.sourceBranch} → ${reviewLog.targetBranch || "N/A"}`,
  );

  // 更新状态为 pending
    return prisma.reviewLog.updateMany({
    where: {
      id: state.reviewLogId,
      status: { not: "cancelled" },
    },
    data: { status: "pending" },
    }).then(() => reviewLog);
  }).then((reviewLog) => {
  log.info(`🔄 [FetchDiffStep] Status updated to: pending`);

  const gitlabService = state.gitlabService;
  if (!gitlabService) {
      throw new Error("GitLab service not initialized");
  }

  const isPushEvent = reviewLog.mergeRequestIid === 0;
    const fetchDiffs = isPushEvent
      ? fetchPushDiffs(state, reviewLog)
      : fetchMergeRequestDiffs(state, reviewLog);

    return fetchDiffs.then((result) => ({ reviewLog, ...result }));
  }).then(({ reviewLog, mr, diffs: rawDiffs, reviewScope, incrementalBaseSha }) => {
  const diffs = mergeDiffsByFile(rawDiffs);
  const relevantDiffs = getReviewableDiffs(diffs);

  log.info(`📁 [FetchDiffStep] Total files changed: ${relevantDiffs.length}`);

  // 更新文件总数
    return prisma.reviewLog.update({
    where: { id: state.reviewLogId },
    data: {
      totalFiles: relevantDiffs.length,
      reviewedFiles: 0,
    },
    }).then(() => ({
      reviewLog,
      mrInfo: mr,
      diffs,
      relevantDiffs,
      reviewScope,
      incrementalBaseSha,
    }));
  });
}
