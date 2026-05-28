/**
 * @file /api/repositories/[id]/memory/graph
 * @description 获取仓库轻量调用图
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return params.then(({ id }) => {
    const url = new URL(request.url);
    const branch = url.searchParams.get("branch") || undefined;
    return Promise.all([
      prisma.codeFileNode.findMany({
        where: { repositoryId: id, ...(branch ? { branch } : {}) },
        orderBy: { filePath: "asc" },
        take: 200,
      }),
      prisma.codeRelationEdge.findMany({
        where: { repositoryId: id, ...(branch ? { branch } : {}) },
        include: {
          fromFileNode: { select: { filePath: true } },
          toFileNode: { select: { filePath: true } },
        },
        take: 500,
      }),
    ]);
  }).then(([files, relations]) => NextResponse.json({
    files,
    relations: relations.map((relation) => ({
      id: relation.id,
      from: relation.fromFileNode.filePath,
      to: relation.toFileNode?.filePath || null,
      relationType: relation.relationType,
      confidence: relation.confidence,
      evidence: relation.evidence,
    })),
  })).catch((error) => {
    console.error("Failed to fetch repository memory graph:", error);
    return NextResponse.json(
      { error: "Failed to fetch repository memory graph" },
      { status: 500 },
    );
  });
}
