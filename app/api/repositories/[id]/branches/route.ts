/**
 * @file /api/repositories/[id]/branches
 * @description 获取仓库远端分支列表
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createGitLabService } from "@/lib/services/gitlab";

export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return params.then(({ id }) => {
    const url = new URL(request.url);
    const search = url.searchParams.get("search")?.trim() || undefined;

    return prisma.repository.findUnique({
      where: { id },
      include: { gitLabAccount: true },
    }).then<NextResponse>((repository) => {
      if (!repository) {
        return NextResponse.json({ error: "Repository not found" }, { status: 404 });
      }

      const gitlabService = createGitLabService(
        repository.gitLabAccount.url,
        repository.gitLabAccount.accessToken,
      );

      return gitlabService.getBranches(repository.gitLabProjectId, {
        search,
        per_page: 100,
        max_pages: 5,
      }).then((branches) => NextResponse.json({
        branches: branches.map((branch) => ({
          name: branch.name,
          commitSha: branch.commit.id,
          committedDate: branch.commit.created_at,
        })),
      }));
    });
  }).catch((error) => {
    console.error("Failed to fetch repository branches:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch repository branches" },
      { status: 500 },
    );
  });
}
