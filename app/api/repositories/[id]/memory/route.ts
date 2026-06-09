import { createLogger } from "@/lib/logger";

const log = createLogger("api.repositories.[id].memory");
/**
 * @file /api/repositories/[id]/memory
 * @description 获取仓库 Code Graph 快照
 */

import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type MemorySnapshotPayload = Prisma.RepositoryMemorySnapshotGetPayload<object>;
type MemoryFactPayload = Prisma.RepositoryMemoryFactGetPayload<object>;
type MemoryBranchPayload = {
  branch: string;
  _max: { lastIndexedAt: Date | null };
};

type MemoryResponsePayload = {
  snapshots: MemorySnapshotPayload[];
  branches: MemoryBranchPayload[];
  facts: MemoryFactPayload[];
  latestSnapshot: MemorySnapshotPayload | null;
  fileCount: number;
  relationCount: number;
  symbolCount: number;
};

export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return params.then(({ id }) => {
    const url = new URL(request.url);
    const branch = url.searchParams.get("branch") || undefined;
    const commitSha = url.searchParams.get("commitSha") || undefined;
    return Promise.all([
      prisma.repositoryMemorySnapshot.findMany({
        where: { repositoryId: id, ...(branch ? { branch } : {}) },
        orderBy: { lastIndexedAt: "desc" },
        take: 20,
      }),
      prisma.repositoryMemorySnapshot.groupBy({
        by: ["branch"],
        where: { repositoryId: id, status: "ready" },
        _max: { lastIndexedAt: true },
      }),
      prisma.repositoryMemoryFact.findMany({
        where: { repositoryId: id, ...(branch ? { branch } : {}) },
        orderBy: { confidence: "desc" },
        take: 50,
      }),
      prisma.repositoryMemorySnapshot.findFirst({
        where: { repositoryId: id, ...(branch ? { branch } : {}), ...(commitSha ? { commitSha } : {}), status: "ready" },
        orderBy: { lastIndexedAt: "desc" },
      }),
    ]).then(([snapshots, branches, facts, selectedSnapshot]) => ({ id, snapshots, branches, facts, selectedSnapshot }));
  }).then<MemoryResponsePayload>(({ id, snapshots, branches, facts, selectedSnapshot }) => {
    const url = new URL(request.url);
    const requestedCommitSha = url.searchParams.get("commitSha") || undefined;
    const latestSnapshot = requestedCommitSha ? selectedSnapshot : selectedSnapshot || snapshots[0];
    if (!latestSnapshot) {
      return {
        snapshots,
        branches,
        facts,
        latestSnapshot: null,
        fileCount: 0,
        relationCount: 0,
        symbolCount: 0,
      };
    }
    return Promise.all([
      prisma.codeFileNode.count({
        where: {
          repositoryId: latestSnapshot.repositoryId,
          branch: latestSnapshot.branch,
          commitSha: latestSnapshot.commitSha,
        },
      }),
      prisma.codeRelationEdge.count({
        where: {
          repositoryId: latestSnapshot.repositoryId,
          branch: latestSnapshot.branch,
          fromFileNode: { commitSha: latestSnapshot.commitSha },
        },
      }),
      prisma.codeSymbolNode.count({
        where: {
          fileNode: {
            repositoryId: id,
            branch: latestSnapshot.branch,
            commitSha: latestSnapshot.commitSha,
          },
        },
      }),
    ]).then(([fileCount, relationCount, symbolCount]) => ({ snapshots, branches, facts, latestSnapshot, fileCount, relationCount, symbolCount }));
  }).then(({ snapshots, branches, facts, latestSnapshot, fileCount, relationCount, symbolCount }) => {
    const memoryJson = latestSnapshot?.memoryJson && typeof latestSnapshot.memoryJson === "object" && !Array.isArray(latestSnapshot.memoryJson)
      ? latestSnapshot.memoryJson as Record<string, unknown>
      : {};

    return NextResponse.json({
      snapshots,
      branches: branches.map((item) => ({
        name: item.branch,
        lastIndexedAt: item._max.lastIndexedAt,
      })),
      selectedSnapshot: latestSnapshot,
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
        baseBranch: typeof memoryJson.baseBranch === "string" ? memoryJson.baseBranch : null,
        baseCommitSha: typeof memoryJson.baseCommitSha === "string" ? memoryJson.baseCommitSha : null,
        changedFiles: Array.isArray(memoryJson.changedFiles) ? memoryJson.changedFiles : [],
        changedFileRoles: Array.isArray(memoryJson.changedFileRoles) ? memoryJson.changedFileRoles : [],
        topLevelStructure: Array.isArray(memoryJson.topLevelStructure) ? memoryJson.topLevelStructure : [],
      },
    });
  })
    .catch((error) => {
      log.error("Failed to fetch repository memory:", error);
      return NextResponse.json(
        { error: "Failed to fetch repository memory" },
        { status: 500 },
      );
    });
}
