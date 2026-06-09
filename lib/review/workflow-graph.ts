import type { ReviewWorkflowNode } from "@prisma/client";

export type WorkflowGraphNode = {
  id: string;
  nodeKey: string;
  parentNodeKey: string | null;
  kind: string;
  status: string;
  title: string;
  summary: string | null;
  detail: string | null;
  sequence: number;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  metricsJson: unknown;
  rawJson: unknown;
  reviewBotRunId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowGraphEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  kind: "main" | "parent" | "agent" | "loop";
};

function toGraphNode(node: ReviewWorkflowNode): WorkflowGraphNode {
  return {
    id: node.nodeKey,
    nodeKey: node.nodeKey,
    parentNodeKey: node.parentNodeKey,
    kind: node.kind,
    status: node.status,
    title: node.title,
    summary: node.summary,
    detail: node.detail,
    sequence: node.sequence,
    startedAt: node.startedAt?.toISOString() || null,
    completedAt: node.completedAt?.toISOString() || null,
    durationMs: node.durationMs,
    metricsJson: node.metricsJson,
    rawJson: node.rawJson,
    reviewBotRunId: node.reviewBotRunId,
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
  };
}

function edgeLabel(node: ReviewWorkflowNode) {
  if (node.kind === "decision") return node.summary || node.detail || "决策";
  if (node.kind === "iteration_stage" && node.nodeKey.includes(":critic")) {
    const metrics = node.metricsJson as { stopReason?: unknown; shouldContinue?: unknown } | null;
    if (typeof metrics?.stopReason === "string") return metrics.stopReason;
  }
  return undefined;
}

export function buildWorkflowGraph(nodes: ReviewWorkflowNode[]) {
  const sorted = [...nodes].sort((left, right) => (
    left.sequence - right.sequence || left.createdAt.getTime() - right.createdAt.getTime()
  ));
  const nodeKeys = new Set(sorted.map((node) => node.nodeKey));
  const edgeMap = new Map<string, WorkflowGraphEdge>();

  sorted.forEach((node, index) => {
    if (node.parentNodeKey && nodeKeys.has(node.parentNodeKey)) {
      const edge: WorkflowGraphEdge = {
        id: `${node.parentNodeKey}->${node.nodeKey}`,
        source: node.parentNodeKey,
        target: node.nodeKey,
        label: edgeLabel(node),
        kind: node.kind === "iteration_stage" ? "loop" : "parent",
      };
      edgeMap.set(edge.id, edge);
      return;
    }

    const previous = sorted[index - 1];
    if (!previous) return;
    const edge: WorkflowGraphEdge = {
      id: `${previous.nodeKey}->${node.nodeKey}`,
      source: previous.nodeKey,
      target: node.nodeKey,
      label: edgeLabel(node),
      kind: "main",
    };
    edgeMap.set(edge.id, edge);
  });

  return {
    nodes: sorted.map(toGraphNode),
    edges: [...edgeMap.values()],
    updatedAt: sorted.reduce<Date | null>((latest, node) => {
      if (!latest || node.updatedAt > latest) return node.updatedAt;
      return latest;
    }, null)?.toISOString() || null,
  };
}
