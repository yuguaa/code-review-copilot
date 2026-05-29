/**
 * @file /api/repositories/[id]/memory/graph
 * @description 获取仓库轻量调用图
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const GRAPH_CACHE_COMMIT_SHA = "__branch_code_graph__";

export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return params.then(({ id }) => {
    const url = new URL(request.url);
    const branch = url.searchParams.get("branch") || undefined;
    return prisma.repositoryMemorySnapshot.findFirst({
      where: { repositoryId: id, ...(branch ? { branch } : {}), status: "ready" },
      orderBy: { lastIndexedAt: "desc" },
    }).then((snapshot) => prisma.codeFileNode.findMany({
        where: {
          repositoryId: id,
          ...(branch ? { branch } : {}),
          commitSha: snapshot?.commitSha || GRAPH_CACHE_COMMIT_SHA,
        },
        orderBy: { filePath: "asc" },
        take: 200,
      }).then((files) => {
        const symbolsPromise = prisma.codeSymbolNode.findMany({
          where: { fileNodeId: { in: files.map((file) => file.id) } },
          include: { fileNode: { select: { filePath: true } } },
          orderBy: [{ kind: "asc" }, { name: "asc" }],
          take: 900,
        });
        const relationsPromise = prisma.codeRelationEdge.findMany({
          where: {
            repositoryId: id,
            ...(branch ? { branch } : {}),
            fromFileNode: { commitSha: snapshot?.commitSha || GRAPH_CACHE_COMMIT_SHA },
          },
          include: {
            fromFileNode: { select: { filePath: true } },
            toFileNode: { select: { filePath: true } },
            fromSymbolNode: { select: { name: true, kind: true } },
            toSymbolNode: { select: { name: true, kind: true } },
          },
          take: 500,
        });

        return Promise.all([symbolsPromise, relationsPromise])
          .then(([symbols, relations]) => ({ snapshot, files, symbols, relations }));
      }));
  }).then(({ snapshot, files, symbols, relations }) => NextResponse.json({
    snapshot,
    files,
    symbols: symbols.map((symbol) => ({
      id: symbol.id,
      filePath: symbol.fileNode.filePath,
      name: symbol.name,
      kind: symbol.kind,
      signature: symbol.signature,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      summary: symbol.summary,
    })),
    relations: relations.map((relation) => ({
      id: relation.id,
      from: relation.fromFileNode.filePath,
      to: relation.toFileNode?.filePath || null,
      fromSymbol: relation.fromSymbolNode ? {
        name: relation.fromSymbolNode.name,
        kind: relation.fromSymbolNode.kind,
      } : null,
      toSymbol: relation.toSymbolNode ? {
        name: relation.toSymbolNode.name,
        kind: relation.toSymbolNode.kind,
      } : null,
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
