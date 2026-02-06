/**
 * @file fetch-diff.ts
 * @description LangGraph 节点：获取 GitLab Diff
 *
 * 此节点负责：
 * 1. 从数据库获取 ReviewLog 信息
 * 2. 根据 MR/Commit 类型调用 GitLab API 获取 diff
 * 3. 过滤并准备待审查的文件列表
 */

import { prisma } from "@/lib/prisma";
import type { ReviewState } from "../types";
import type { GitLabDiff, GitLabMergeRequest, AIProvider } from "@/lib/types";

/**
 * 获取 GitLab Diff 节点
 */
export async function fetchDiffNode(state: ReviewState): Promise<Partial<ReviewState>> {
  console.log(`🔍 [FetchDiffNode] Starting review for log: ${state.reviewLogId}`);

  const reviewLog = await prisma.reviewLog.findUnique({
    where: { id: state.reviewLogId },
    include: {
      repository: {
        include: {
          gitLabAccount: true,
          defaultAIModel: true,
        },
      },
    },
  });

  if (!reviewLog) {
    console.error(`❌ [FetchDiffNode] Review log not found: ${state.reviewLogId}`);
    return {
      error: "Review log not found",
      completed: true,
    };
  }

  console.log(`📋 [FetchDiffNode] Review: ${reviewLog.title}`);
  console.log(
    `📂 [FetchDiffNode] Branch: ${reviewLog.sourceBranch} → ${reviewLog.targetBranch || "N/A"}`,
  );

  // 更新状态为 pending
  await prisma.reviewLog.update({
    where: { id: state.reviewLogId },
    data: { status: "pending" },
  });
  console.log(`🔄 [FetchDiffNode] Status updated to: pending`);

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

  if (isPushEvent) {
    console.log(
      `📌 [FetchDiffNode] Processing Push event for commit: ${reviewLog.commitSha}`,
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

    // 使用 changes API 获取 MR 的所有变更（包含所有 commits 的 diff）
    console.log(`📌 [FetchDiffNode] Fetching all changes for MR !${reviewLog.mergeRequestIid}`);
    diffs = await gitlabService.getMergeRequestChanges(
      reviewLog.repository.gitLabProjectId,
      reviewLog.mergeRequestIid,
    );

    if (!diffs || diffs.length === 0) {
      console.log(`⏭️ [FetchDiffNode] No changes found in MR`);
      return {
        error: "No changes found in merge request",
        completed: true,
      };
    }

    console.log(`📌 [FetchDiffNode] Found ${diffs.length} files with changes in MR`);
  }

  const relevantDiffs = diffs.filter((diff) => !diff.deleted_file);

  console.log(`📁 [FetchDiffNode] Total files changed: ${relevantDiffs.length}`);

  // 更新文件总数
  await prisma.reviewLog.update({
    where: { id: state.reviewLogId },
    data: {
      totalFiles: relevantDiffs.length,
      reviewedFiles: 0,
    },
  });

  // 准备 AI 模型配置
  const repository = reviewLog.repository;
  const modelConfig = {
    id: repository.customProvider ? "custom" : (repository.defaultAIModel?.id || "default"),
    name: repository.customModelId || repository.defaultAIModel?.modelId || "default",
    provider: (repository.customProvider || repository.defaultAIModel?.provider || "openai") as AIProvider,
    modelId: repository.customModelId || repository.defaultAIModel?.modelId || "gpt-4o",
    apiKey: repository.customApiKey || repository.defaultAIModel?.apiKey || "",
    apiEndpoint: repository.customApiEndpoint || repository.defaultAIModel?.apiEndpoint || undefined,
    maxTokens: repository.customMaxTokens || repository.defaultAIModel?.maxTokens || undefined,
    temperature: repository.customTemperature || repository.defaultAIModel?.temperature || undefined,
    isActive: true,
  };

  console.log(
    `🤖 [FetchDiffNode] Using AI model: ${modelConfig.provider}/${modelConfig.modelId}`,
  );

  // 仓库配置
  const repositoryConfig = {
    customPrompt: repository.customPrompt,
    customPromptMode: (repository.customPromptMode || "extend") as "extend" | "replace",
  };

  return {
    reviewLog,
    mrInfo: mr,
    diffs,
    relevantDiffs,
    modelConfig,
    repositoryConfig,
  };
}
