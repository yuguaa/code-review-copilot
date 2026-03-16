/**
 * @file /api/dashboard/contributions
 * @description 获取贡献趋势（按天聚合）
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createGitLabService } from "@/lib/services/gitlab";

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildDateRange(days: number): { dates: string[]; start: Date; end: Date } {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);

  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return { dates, start, end };
}

/** GET /api/dashboard/contributions?repositoryId=xxx */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const repositoryId = searchParams.get("repositoryId");
    const days = 365;

    const repositories = repositoryId
      ? await prisma.repository.findMany({
          where: { id: repositoryId },
          include: { gitLabAccount: true },
        })
      : await prisma.repository.findMany({
          where: { isActive: true },
          include: { gitLabAccount: true },
        });

    const { dates, start, end } = buildDateRange(days);
    const counts = new Map(dates.map((date) => [date, 0]));
    const authorMap = new Map<string, number[]>();

    for (const repo of repositories) {
      const gitlabService = createGitLabService(
        repo.gitLabAccount.url,
        repo.gitLabAccount.accessToken
      );

      const commits = await gitlabService.getProjectCommits(repo.gitLabProjectId, {
        since: start.toISOString(),
        until: end.toISOString(),
        per_page: 100,
        max_pages: 200,
      });

      for (const commit of commits) {
        const key = commit.created_at
          ? commit.created_at.slice(0, 10)
          : null;
        if (key && counts.has(key)) {
          counts.set(key, (counts.get(key) || 0) + 1);
          const author = commit.author_name || "未知";
          let series = authorMap.get(author);
          if (!series) {
            series = new Array(dates.length).fill(0);
            authorMap.set(author, series);
          }
          const index = dates.indexOf(key);
          if (index >= 0) {
            series[index] += 1;
          }
        }
      }
    }

    const series = dates.map((date) => ({
      date,
      count: counts.get(date) || 0,
    }));

    const authors = Array.from(authorMap.entries())
      .map(([name, countsByDate]) => ({
        name,
        counts: countsByDate,
        total: countsByDate.reduce((sum, value) => sum + value, 0),
      }))
      .sort((a, b) => b.total - a.total);

    return NextResponse.json({
      series,
      authors,
      dates,
      repositories: repositories.map((repo) => ({
        id: repo.id,
        name: repo.name,
      })),
    });
  } catch (error) {
    console.error("Failed to fetch contributions:", error);
    return NextResponse.json(
      { error: "Failed to fetch contributions" },
      { status: 500 },
    );
  }
}
