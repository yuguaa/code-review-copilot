/**
 * @file /api/repositories/[id]/memory/refresh
 * @description 手动刷新仓库 Code Graph
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createGitLabService } from "@/lib/services/gitlab";
import { memoryIndexService } from "@/lib/services/memory-index";

function resolveRequestedBranch(url: URL, watchBranches: string | null): string {
  const branch = url.searchParams.get("branch")?.trim();
  if (branch) return branch;
  const watchedBranch = watchBranches
    ?.split(",")
    .map((item) => item.trim())
    .find((item) => item && !item.includes("*"));
  return watchedBranch || "main";
}

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

    const branch = resolveRequestedBranch(url, repository.watchBranches);
    const gitlabService = createGitLabService(
      repository.gitLabAccount.url,
      repository.gitLabAccount.accessToken,
    );

    const remoteBranch = await gitlabService.getBranch(repository.gitLabProjectId, branch);
    const commitSha = remoteBranch.commit.id;
    if (!commitSha) {
      throw new Error(`Cannot resolve latest commit for branch ${branch}`);
    }

    const existingSnapshot = await prisma.repositoryMemorySnapshot.findFirst({
      where: { repositoryId: repository.id, branch, status: "ready" },
      orderBy: { lastIndexedAt: "desc" },
    });
    const previousIndexedCommitSha = existingSnapshot?.commitSha || null;
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
      baseBranch: existingSnapshot && !forceRebuild ? branch : null,
      baseCommitSha: existingSnapshot && !forceRebuild ? existingSnapshot.commitSha : null,
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
