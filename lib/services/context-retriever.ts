import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

type GraphRelation = Prisma.CodeRelationEdgeGetPayload<{
  include: {
    fromFileNode: true;
    toFileNode: true;
  };
}>;

export interface RetrievedAgentContext {
  architectureSummary: string;
  memoryFacts: Array<{
    id: string;
    type: string;
    content: string;
    confidence: number;
    evidence: string;
  }>;
  fileContexts: Array<{
    filePath: string;
    role: string;
    summary: string;
    imports: unknown;
    exports: unknown;
  }>;
  graphNeighbors: Array<{
    from: string;
    to: string | null;
    relationType: string;
    evidence: string;
    confidence: number;
  }>;
  relatedReviews: Array<{
    id: string;
    title: string;
    status: string;
    commitShortId: string;
    issueCount: number;
  }>;
  summary: string;
}

export class ContextRetrieverService {
  getContext(params: {
    repositoryId: string;
    branch: string;
    commitSha: string;
    changedFiles: string[];
    maxFiles?: number;
    maxDepth?: number;
  }): Promise<RetrievedAgentContext> {
    const maxFiles = params.maxFiles ?? 12;
    const maxDepth = Math.max(0, Math.trunc(params.maxDepth ?? 2));
    const selectedFiles = params.changedFiles.slice(0, maxFiles);

    return Promise.all([
      prisma.repositoryMemorySnapshot.findFirst({
        where: {
          repositoryId: params.repositoryId,
          branch: params.branch,
          commitSha: params.commitSha,
          status: "ready",
        },
        orderBy: { lastIndexedAt: "desc" },
      }),
      prisma.repositoryMemoryFact.findMany({
        where: {
          repositoryId: params.repositoryId,
          branch: params.branch,
        },
        orderBy: { confidence: "desc" },
        take: 20,
      }),
      prisma.codeFileNode.findMany({
        where: {
          repositoryId: params.repositoryId,
          branch: params.branch,
          commitSha: params.commitSha,
          filePath: { in: selectedFiles },
        },
      }),
      prisma.reviewLog.findMany({
        where: {
          repositoryId: params.repositoryId,
          status: "completed",
          comments: {
            some: {
              filePath: { in: selectedFiles },
            },
          },
        },
        orderBy: { completedAt: "desc" },
        take: 5,
      }),
    ]).then(([snapshot, facts, fileNodes, relatedReviews]) => {
      return this.getGraphRelations({
        repositoryId: params.repositoryId,
        branch: params.branch,
        seedFileNodeIds: fileNodes.map((node) => node.id),
        maxDepth,
        maxEdges: Math.max(60, maxFiles * 8),
      }).then((relations) => {
        const fileContexts = fileNodes.map((node) => ({
          filePath: node.filePath,
          role: node.role,
          summary: node.summary,
          imports: node.importsJson,
          exports: node.exportsJson,
        }));

        const graphNeighbors = relations.map((edge) => ({
          from: edge.fromFileNode.filePath,
          to: edge.toFileNode?.filePath || null,
          relationType: edge.relationType,
          evidence: edge.evidence,
          confidence: edge.confidence,
        }));

        const architectureSummary = snapshot?.architectureSummary || "当前仓库尚无可用架构摘要。";
        const summary = [
          `架构摘要：${architectureSummary}`,
          fileContexts.length
            ? `相关文件：${fileContexts.map((item) => `${item.filePath}(${item.role})`).join("，")}`
            : "相关文件：暂无索引命中",
          graphNeighbors.length
            ? `调用关系：${graphNeighbors.slice(0, 10).map((item) => `${item.from} -> ${item.to || "external"}`).join("；")}`
            : "调用关系：暂无",
          facts.length
            ? `记忆事实：${facts.slice(0, 6).map((item) => item.content).join("；")}`
            : "记忆事实：暂无",
        ].join("\n");

        return {
          architectureSummary,
          memoryFacts: facts.map((fact) => ({
            id: fact.id,
            type: fact.type,
            content: fact.content,
            confidence: fact.confidence,
            evidence: fact.evidence,
          })),
          fileContexts,
          graphNeighbors,
          relatedReviews: relatedReviews.map((review) => ({
            id: review.id,
            title: review.title,
            status: review.status,
            commitShortId: review.commitShortId,
            issueCount: review.criticalIssues + review.normalIssues + review.suggestions,
          })),
          summary,
        };
      });
    });
  }

  private getGraphRelations(params: {
    repositoryId: string;
    branch: string;
    seedFileNodeIds: string[];
    maxDepth: number;
    maxEdges: number;
  }): Promise<GraphRelation[]> {
    if (params.maxDepth <= 0 || params.seedFileNodeIds.length === 0) {
      return Promise.resolve([]);
    }

    const collected = new Map<string, GraphRelation>();
    const visited = new Set<string>();
    let frontier = [...new Set(params.seedFileNodeIds)];
    let depth = 0;

    const loadNextDepth = (): Promise<GraphRelation[]> => {
      if (depth >= params.maxDepth || frontier.length === 0 || collected.size >= params.maxEdges) {
        return Promise.resolve([...collected.values()]);
      }

      const currentFrontier = frontier.filter((id) => !visited.has(id));
      currentFrontier.forEach((id) => visited.add(id));

      if (currentFrontier.length === 0) {
        return Promise.resolve([...collected.values()]);
      }

      return prisma.codeRelationEdge.findMany({
        where: {
          repositoryId: params.repositoryId,
          branch: params.branch,
          OR: [
            { fromFileNodeId: { in: currentFrontier } },
            { toFileNodeId: { in: currentFrontier } },
          ],
        },
        include: {
          fromFileNode: true,
          toFileNode: true,
        },
        take: params.maxEdges - collected.size,
      }).then((relations) => {
        const nextFrontier = new Set<string>();

        relations.forEach((edge) => {
          collected.set(edge.id, edge);
          if (!visited.has(edge.fromFileNodeId)) {
            nextFrontier.add(edge.fromFileNodeId);
          }
          if (edge.toFileNodeId && !visited.has(edge.toFileNodeId)) {
            nextFrontier.add(edge.toFileNodeId);
          }
        });

        frontier = [...nextFrontier];
        depth += 1;
        return loadNextDepth();
      });
    };

    return loadNextDepth();
  }
}

export const contextRetrieverService = new ContextRetrieverService();
