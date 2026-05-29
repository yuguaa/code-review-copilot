/**
 * @file /api/repositories/[id]/memory
 * @description 获取仓库 Memory Wiki
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCodeGraphCacheCommitSha } from "@/lib/services/memory-index";

export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return params.then(({ id }) => {
    const graphCacheCommitSha = getCodeGraphCacheCommitSha();
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
      prisma.codeFileNode.count({
        where: { repositoryId: id, commitSha: graphCacheCommitSha },
      }),
      prisma.codeRelationEdge.count({
        where: { repositoryId: id, fromFileNode: { commitSha: graphCacheCommitSha } },
      }),
      prisma.codeSymbolNode.count({
        where: { fileNode: { repositoryId: id, commitSha: graphCacheCommitSha } },
      }),
    ]);
  }).then(([snapshots, facts, fileCount, relationCount, symbolCount]) => {
    const latestSnapshot = snapshots[0];
    const memoryJson = latestSnapshot?.memoryJson && typeof latestSnapshot.memoryJson === "object" && !Array.isArray(latestSnapshot.memoryJson)
      ? latestSnapshot.memoryJson as Record<string, unknown>
      : {};

    return NextResponse.json({
      snapshots,
      facts,
      codeGraph: {
        fileCount,
        relationCount,
        symbolCount,
        updateMode: typeof memoryJson.updateMode === "string" ? memoryJson.updateMode : null,
        reuseReason: typeof memoryJson.reuseReason === "string" ? memoryJson.reuseReason : null,
        lastIndexedCommitSha: typeof memoryJson.lastIndexedCommitSha === "string" ? memoryJson.lastIndexedCommitSha : null,
        previousIndexedCommitSha: typeof memoryJson.previousIndexedCommitSha === "string" ? memoryJson.previousIndexedCommitSha : null,
        sourceCommitSha: typeof memoryJson.sourceCommitSha === "string" ? memoryJson.sourceCommitSha : null,
        changedFiles: Array.isArray(memoryJson.changedFiles) ? memoryJson.changedFiles : [],
        changedFileRoles: Array.isArray(memoryJson.changedFileRoles) ? memoryJson.changedFileRoles : [],
        topLevelStructure: Array.isArray(memoryJson.topLevelStructure) ? memoryJson.topLevelStructure : [],
      },
    });
  })
    .catch((error) => {
      console.error("Failed to fetch repository memory:", error);
      return NextResponse.json(
        { error: "Failed to fetch repository memory" },
        { status: 500 },
      );
    });
}
