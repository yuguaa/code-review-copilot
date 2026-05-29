import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

type GraphRelation = Prisma.CodeRelationEdgeGetPayload<{
  include: {
    fromFileNode: true;
    toFileNode: true;
  };
}>;

export interface RetrievedAgentContext {
  codeGraph: {
    available: boolean;
    status: string;
    graphCommitSha: string;
    lastIndexedCommitSha: string | null;
    previousIndexedCommitSha: string | null;
    sourceCommitSha: string | null;
    lastIndexedAt: string | null;
    updateMode: string | null;
    indexedFiles: number;
    changedFilesIndexed: number;
    recommendation: string;
  };
  tools: Array<{
    name: string;
    status: "available" | "unavailable";
    description: string;
    observation: string;
  }>;
  architectureSummary: string;
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
    ]).then(([snapshot, fileNodes, relatedReviews]) => {
      return this.getGraphRelations({
        repositoryId: params.repositoryId,
        branch: params.branch,
        commitSha: params.commitSha,
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

        const memoryJson = snapshot?.memoryJson && typeof snapshot.memoryJson === "object" && !Array.isArray(snapshot.memoryJson)
          ? snapshot.memoryJson as Record<string, unknown>
          : {};
        const codeGraph = {
          available: Boolean(snapshot),
          status: snapshot?.status || "missing",
          graphCommitSha: snapshot?.commitSha || params.commitSha,
          lastIndexedCommitSha: typeof memoryJson.lastIndexedCommitSha === "string" ? memoryJson.lastIndexedCommitSha : null,
          previousIndexedCommitSha: typeof memoryJson.previousIndexedCommitSha === "string" ? memoryJson.previousIndexedCommitSha : null,
          sourceCommitSha: typeof memoryJson.sourceCommitSha === "string" ? memoryJson.sourceCommitSha : null,
          lastIndexedAt: snapshot?.lastIndexedAt?.toISOString() || null,
          updateMode: typeof memoryJson.updateMode === "string" ? memoryJson.updateMode : null,
          indexedFiles: typeof memoryJson.indexedFiles === "number" ? memoryJson.indexedFiles : 0,
          changedFilesIndexed: fileContexts.length,
          recommendation: snapshot
            ? "Code Graph 已可用，优先使用 get_call_graph_neighbors 和 get_file_context 做跨文件审查。"
            : "Code Graph 不存在，系统应先执行 GitLab Code Graph 索引器全量重建，再进行深度跨文件审查。",
        };
        const tools = this.buildToolCatalog({
          codeGraphAvailable: codeGraph.available,
          fileContextCount: fileContexts.length,
          graphNeighborCount: graphNeighbors.length,
          relatedReviewCount: relatedReviews.length,
        });
        const architectureSummary = snapshot?.architectureSummary || "当前仓库尚无可用架构摘要。";
        const summary = [
          `Code Graph：${codeGraph.available ? `可用，模式=${codeGraph.updateMode || "unknown"}，索引文件=${codeGraph.indexedFiles}` : "不可用，需要先重建 Code Graph"}`,
          `Agent Tools：${tools.map((tool) => `${tool.name}(${tool.status})`).join("，")}`,
          `架构摘要：${architectureSummary}`,
          fileContexts.length
            ? `相关文件：${fileContexts.map((item) => `${item.filePath}(${item.role})`).join("，")}`
            : "相关文件：暂无索引命中",
          graphNeighbors.length
            ? `调用关系：${graphNeighbors.slice(0, 10).map((item) => `${item.from} -> ${item.to || "external"}`).join("；")}`
            : "调用关系：暂无",
        ].join("\n");

        return {
          codeGraph,
          tools,
          architectureSummary,
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

  private buildToolCatalog(params: {
    codeGraphAvailable: boolean;
    fileContextCount: number;
    graphNeighborCount: number;
    relatedReviewCount: number;
  }): RetrievedAgentContext["tools"] {
    return [
      {
        name: "get_code_graph_status",
        status: "available",
        description: "检查当前分支 Code Graph 是否存在、索引模式和更新时间。",
        observation: params.codeGraphAvailable ? "Code Graph 已存在。" : "Code Graph 缺失，需要强制重建。",
      },
      {
        name: "get_architecture_summary",
        status: params.codeGraphAvailable ? "available" : "unavailable",
        description: "读取基于 Code Graph 的项目架构摘要。",
        observation: params.codeGraphAvailable ? "可用于判断模块边界和入口。" : "缺少 Code Graph，无法提供可靠架构摘要。",
      },
      {
        name: "get_file_context",
        status: params.fileContextCount > 0 ? "available" : "unavailable",
        description: "读取变更文件在 Code Graph 中的角色、imports、exports。",
        observation: params.fileContextCount > 0 ? `命中 ${params.fileContextCount} 个文件上下文。` : "变更文件未命中图节点。",
      },
      {
        name: "get_call_graph_neighbors",
        status: params.graphNeighborCount > 0 ? "available" : "unavailable",
        description: "读取变更文件的图邻居关系，用于跨文件影响分析。",
        observation: params.graphNeighborCount > 0 ? `命中 ${params.graphNeighborCount} 条关系。` : "暂无可用图邻居。",
      },
      {
        name: "get_related_review_history",
        status: params.relatedReviewCount > 0 ? "available" : "unavailable",
        description: "读取相关文件历史审查问题。",
        observation: params.relatedReviewCount > 0 ? `命中 ${params.relatedReviewCount} 条历史审查。` : "暂无相关历史审查。",
      },
      {
        name: "rebuild_code_graph",
        status: params.codeGraphAvailable ? "unavailable" : "available",
        description: "当 Code Graph 缺失时，请求系统执行 GitLab Code Graph 索引器全量重建。",
        observation: params.codeGraphAvailable ? "当前无需重建。" : "应先执行 /memory/refresh?force=true 重建 Code Graph，再做深度跨文件审查。",
      },
    ];
  }

  private getGraphRelations(params: {
    repositoryId: string;
    branch: string;
    commitSha: string;
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
          fromFileNode: { commitSha: params.commitSha },
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
