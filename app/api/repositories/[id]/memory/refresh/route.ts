/**
 * @file /api/repositories/[id]/memory/refresh
 * @description 手动刷新仓库 Memory Wiki
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createGitLabService } from "@/lib/services/gitlab";
import { memoryIndexService } from "@/lib/services/memory-index";

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

    const commits = await gitlabService.getProjectCommits(repository.gitLabProjectId, {
      ref_name: branch,
      per_page: 1,
      max_pages: 1,
    });
    const commitSha = commits[0]?.id;
    if (!commitSha) {
      throw new Error(`Cannot resolve latest commit for branch ${branch}`);
    }
    const diffs = await gitlabService.getCommitDiff(repository.gitLabProjectId, commitSha);
    const snapshot = await memoryIndexService.refreshRepositoryMemory({
      repositoryId: repository.id,
      gitLabProjectId: repository.gitLabProjectId,
      gitlabService,
      branch,
      commitSha,
      diffs,
      forceRebuild,
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
