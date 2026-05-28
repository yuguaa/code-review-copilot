import { prisma } from "@/lib/prisma";

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
      const fileNodeIds = fileNodes.map((node) => node.id);
      return prisma.codeRelationEdge.findMany({
        where: {
          repositoryId: params.repositoryId,
          branch: params.branch,
          OR: [
            { fromFileNodeId: { in: fileNodeIds } },
            { toFileNodeId: { in: fileNodeIds } },
          ],
        },
        include: {
          fromFileNode: true,
          toFileNode: true,
        },
        take: 60,
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
}

export const contextRetrieverService = new ContextRetrieverService();
