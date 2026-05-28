/**
 * @file /api/repositories/[id]/memory
 * @description 获取仓库 Memory Wiki
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return params.then(({ id }) => {
    return Promise.all([
      prisma.repositoryMemorySnapshot.findMany({
        where: { repositoryId: id },
        orderBy: { lastIndexedAt: "desc" },
        take: 5,
      }),
      prisma.repositoryMemoryFact.findMany({
        where: { repositoryId: id },
        orderBy: { confidence: "desc" },
        take: 50,
      }),
    ]);
  }).then(([snapshots, facts]) => NextResponse.json({ snapshots, facts }))
    .catch((error) => {
      console.error("Failed to fetch repository memory:", error);
      return NextResponse.json(
        { error: "Failed to fetch repository memory" },
        { status: 500 },
      );
    });
}
