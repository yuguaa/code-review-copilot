import { createLogger } from "@/lib/logger";

const log = createLogger("api.repositories.[id].memory.graph");
/**
 * @file /api/repositories/[id]/memory/graph
 * @description 获取仓库轻量调用图
 */

import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type CodeGraphDbFile = {
  path: string;
  content_hash: string;
  language: string;
  size: number;
  modified_at: number;
  indexed_at: number;
  node_count: number;
  errors: string | null;
};

type CodeGraphDbNode = {
  id: string;
  kind: string;
  name: string;
  qualified_name: string;
  file_path: string;
  language: string;
  start_line: number;
  end_line: number;
  start_column: number;
  end_column: number;
  docstring: string | null;
  signature: string | null;
  visibility: string | null;
  is_exported: number;
  is_async: number;
  is_static: number;
  is_abstract: number;
  decorators: string | null;
  type_parameters: string | null;
  updated_at: number;
};

type CodeGraphDbEdge = {
  source: string;
  target: string;
  kind: string;
  metadata: string | null;
  line: number | null;
  col: number | null;
  provenance: string | null;
};

type CodeGraphDb = {
  schema_versions: Array<{ version: number; applied_at: number; description: string }>;
  files: CodeGraphDbFile[];
  nodes: CodeGraphDbNode[];
  edges: CodeGraphDbEdge[];
  unresolved_refs: Array<Record<string, unknown>>;
  project_metadata: Array<Record<string, unknown>>;
};

type CodeGraphPayload = {
  snapshot: Prisma.RepositoryMemorySnapshotGetPayload<object> | null;
  codegraphDb: CodeGraphDb | null;
  files: Prisma.CodeFileNodeGetPayload<object>[];
  symbols: Prisma.CodeSymbolNodeGetPayload<{
    include: { fileNode: { select: { filePath: true } } };
  }>[];
  relations: Prisma.CodeRelationEdgeGetPayload<{
    include: {
      fromFileNode: { select: { filePath: true } };
      toFileNode: { select: { filePath: true } };
      fromSymbolNode: { select: { name: true; kind: true } };
      toSymbolNode: { select: { name: true; kind: true } };
    };
  }>[];
};

function detectRole(filePath: string): string {
  if (filePath.includes("/api/") && filePath.endsWith("route.ts")) return "api_route";
  if (filePath.startsWith("app/") && filePath.endsWith("page.tsx")) return "page";
  if (filePath.includes("components/")) return "component";
  if (filePath.includes("lib/services/")) return "service";
  if (filePath.includes("lib/review/steps/")) return "review_step";
  if (filePath.startsWith("lib/review/")) return "review_core";
  if (filePath.includes("prisma/")) return "data_model";
  if (filePath.includes("hooks/")) return "hook";
  if (filePath.includes("scripts/") || filePath.startsWith("scripts/")) return "script";
  if (filePath.endsWith("package.json") || filePath.endsWith("tsconfig.json")) return "project_config";
  return "module";
}

function readCodegraphDb(memoryJson: Prisma.JsonValue | null): CodeGraphDb | null {
  if (!memoryJson || typeof memoryJson !== "object" || Array.isArray(memoryJson)) return null;
  const value = (memoryJson as Record<string, unknown>).codegraphDb;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<CodeGraphDb>;
  if (!Array.isArray(candidate.files) || !Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)) return null;
  return {
    schema_versions: Array.isArray(candidate.schema_versions) ? candidate.schema_versions : [],
    files: candidate.files,
    nodes: candidate.nodes,
    edges: candidate.edges,
    unresolved_refs: Array.isArray(candidate.unresolved_refs) ? candidate.unresolved_refs : [],
    project_metadata: Array.isArray(candidate.project_metadata) ? candidate.project_metadata : [],
  };
}

function parseEdgeMetadata(metadata: string | null): { confidence?: number } {
  if (!metadata) return {};
  try {
    const value = JSON.parse(metadata) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as { confidence?: number }
      : {};
  } catch {
    return {};
  }
}

export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return params.then(({ id }) => {
    const url = new URL(request.url);
    const branch = url.searchParams.get("branch") || undefined;
    const commitSha = url.searchParams.get("commitSha") || undefined;
    return prisma.repositoryMemorySnapshot.findFirst({
      where: { repositoryId: id, ...(branch ? { branch } : {}), ...(commitSha ? { commitSha } : {}), status: "ready" },
      orderBy: { lastIndexedAt: "desc" },
    }).then<CodeGraphPayload>((snapshot) => {
      if (!snapshot) {
        return {
          snapshot: null,
          codegraphDb: null,
          files: [],
          symbols: [],
          relations: [],
        };
      }
      const codegraphDb = readCodegraphDb(snapshot.memoryJson);

      return prisma.codeFileNode.findMany({
        where: {
          repositoryId: id,
          branch: snapshot.branch,
          commitSha: snapshot.commitSha,
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
            branch: snapshot.branch,
            fromFileNode: { commitSha: snapshot.commitSha },
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
          .then(([symbols, relations]) => ({ snapshot, codegraphDb, files, symbols, relations }));
      });
    });
  }).then(({ snapshot, codegraphDb, files, symbols, relations }) => {
    if (codegraphDb) {
      const fileRoleByPath = new Map(files.map((file) => [file.filePath, file.role]));
      const nodeById = new Map(codegraphDb.nodes.map((node) => [node.id, node]));
      const nextFiles = codegraphDb.files.map((file) => ({
        id: `file:${file.path}`,
        filePath: file.path,
        role: fileRoleByPath.get(file.path) || detectRole(file.path),
        language: file.language,
        summary: `${file.path} 已索引 ${file.node_count} 个节点，文件大小 ${file.size} bytes。`,
      }));
      const nextSymbols = codegraphDb.nodes
        .filter((node) => node.kind !== "file" && node.kind !== "import")
        .map((node) => ({
          id: node.id,
          filePath: node.file_path,
          name: node.name,
          kind: node.kind,
          signature: node.signature,
          startLine: node.start_line,
          endLine: node.end_line,
          summary: node.docstring || node.signature || `${node.kind} ${node.name}`,
        }));
      const nextRelations = codegraphDb.edges
        .filter((edge) => edge.kind !== "contains")
        .map((edge, index) => {
          const source = nodeById.get(edge.source);
          const target = nodeById.get(edge.target);
          const metadata = parseEdgeMetadata(edge.metadata);
          return {
            id: `${edge.source}:${edge.target}:${edge.kind}:${index}`,
            from: source?.file_path || edge.source,
            to: target?.kind === "import" ? null : target?.file_path || null,
            fromSymbol: source && source.kind !== "file" && source.kind !== "import" ? {
              name: source.name,
              kind: source.kind,
            } : null,
            toSymbol: target && target.kind !== "file" && target.kind !== "import" ? {
              name: target.name,
              kind: target.kind,
            } : null,
            relationType: edge.kind,
            confidence: typeof metadata.confidence === "number" ? metadata.confidence : 0.7,
            evidence: `${edge.source} ${edge.kind} ${edge.target}`,
          };
        });

      return NextResponse.json({
        snapshot,
        codegraphDb,
        files: nextFiles,
        symbols: nextSymbols,
        relations: nextRelations,
      });
    }

    return NextResponse.json({
      snapshot,
      codegraphDb: null,
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
    });
  }).catch((error) => {
    log.error("Failed to fetch repository memory graph:", error);
    return NextResponse.json(
      { error: "Failed to fetch repository memory graph" },
      { status: 500 },
    );
  });
}
