/**
 * @file /api/repositories/[id]/memory/refresh
 * @description 手动刷新仓库 Memory Wiki
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createGitLabService } from "@/lib/services/gitlab";
import { getCodeGraphCacheCommitSha, memoryIndexService } from "@/lib/services/memory-index";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const forceRebuild = url.searchParams.get("force") === "true";
    const repository = await prisma.repository.findUnique({
      where: { id },
      include: { gitLabAccount: true },
    });

    if (!repository) {
      return NextResponse.json({ error: "Repository not found" }, { status: 404 });
    }

    const branch = repository.watchBranches?.split(",")[0]?.replace("*", "").trim() || "main";
    const gitlabService = createGitLabService(
      repository.gitLabAccount.url,
      repository.gitLabAccount.accessToken,
    );

    const remoteBranch = await gitlabService.getBranch(repository.gitLabProjectId, branch);
    const commitSha = remoteBranch.commit.id;
    if (!commitSha) {
      throw new Error(`Cannot resolve latest commit for branch ${branch}`);
    }

    const graphCacheCommitSha = getCodeGraphCacheCommitSha();
    const existingSnapshot = await prisma.repositoryMemorySnapshot.findUnique({
      where: {
        repositoryId_branch_commitSha: {
          repositoryId: repository.id,
          branch,
          commitSha: graphCacheCommitSha,
        },
      },
    });
    const memoryJson = existingSnapshot?.memoryJson && typeof existingSnapshot.memoryJson === "object" && !Array.isArray(existingSnapshot.memoryJson)
      ? existingSnapshot.memoryJson as Record<string, unknown>
      : {};
    const previousIndexedCommitSha = typeof memoryJson.lastIndexedCommitSha === "string" ? memoryJson.lastIndexedCommitSha : null;
    const diffs = forceRebuild
      ? []
      : previousIndexedCommitSha && previousIndexedCommitSha !== commitSha
        ? (await gitlabService.compareCommits(repository.gitLabProjectId, previousIndexedCommitSha, commitSha)).diffs
        : await gitlabService.getCommitDiff(repository.gitLabProjectId, commitSha);
    const snapshot = await memoryIndexService.refreshRepositoryMemory({
      repositoryId: repository.id,
      gitLabProjectId: repository.gitLabProjectId,
      gitlabService,
      branch,
      commitSha,
      diffs,
      forceRebuild,
      previousIndexedCommitSha,
    });
    return NextResponse.json({ success: true, snapshot });
  } catch (error) {
    console.error("Failed to refresh repository memory:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to refresh repository memory" },
      { status: 500 },
    );
  }
}
