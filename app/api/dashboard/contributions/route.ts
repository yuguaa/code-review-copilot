/**
 * @file /api/dashboard/contributions
 * @description 获取贡献趋势（按天聚合）
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
    const authorFilter = searchParams.get("author");
    const days = 365;

    const repositories = repositoryId
      ? await prisma.repository.findMany({
          where: { id: repositoryId },
        })
      : await prisma.repository.findMany({
          where: { isActive: true },
        });

    const { dates, start, end } = buildDateRange(days);
    const counts = new Map(dates.map((date) => [date, 0]));
    const authorMap = new Map<string, number[]>();
    const topReviewedUsers = await prisma.reviewLog.groupBy({
      by: ["authorUsername"],
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 10,
      where: {
        authorUsername: { not: null },
        startedAt: { gte: start },
      },
    });
    const usernames = topReviewedUsers
      .map((item) => item.authorUsername)
      .filter((value): value is string => Boolean(value));
    const reviewedAuthors = await prisma.reviewLog.findMany({
      where: {
        authorUsername: { in: usernames },
      },
      select: {
        author: true,
        authorUsername: true,
      },
      distinct: ["authorUsername"],
    });
    const allAuthorOptions = Array.from(
      new Set(
        reviewedAuthors
          .flatMap((item) => [item.author, item.authorUsername])
          .filter((value): value is string => Boolean(value))
      )
    );
    const authorSet = new Set(
      reviewedAuthors
        .flatMap((item) => [item.author, item.authorUsername])
        .filter((value): value is string => Boolean(value))
    );
    if (authorFilter) {
      authorSet.clear();
      authorSet.add(authorFilter);
    }

    const repositoryIds = repositories.map((repo) => repo.id);
    const reviewLogs = await prisma.reviewLog.findMany({
      where: {
        repositoryId: repositoryId ? repositoryId : { in: repositoryIds },
        startedAt: {
          gte: start,
          lte: end,
        },
        OR: authorFilter
          ? [
              { authorUsername: authorFilter },
              { author: authorFilter },
            ]
          : [
              { authorUsername: { in: usernames } },
              { author: { in: Array.from(authorSet) } },
            ],
      },
      select: {
        author: true,
        authorUsername: true,
        startedAt: true,
      },
    });

    for (const log of reviewLogs) {
      const key = log.startedAt.toISOString().slice(0, 10);
      if (!counts.has(key)) continue;

      const author = log.author || log.authorUsername || "未知";
      if (!authorSet.has(author)) continue;

      counts.set(key, (counts.get(key) || 0) + 1);
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
      authorOptions: allAuthorOptions,
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
