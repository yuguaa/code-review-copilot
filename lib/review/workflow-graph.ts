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
  piReviewRunId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowGraphEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  kind: "main" | "parent" | "runtime" | "loop";
};

const RUN_PI_RUNTIME_NODE_KEY = "run_pi_runtime";
const AGGREGATE_NODE_KEY = "aggregate";

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
    piReviewRunId: node.piReviewRunId,
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

function resolveParentNodeKey(node: ReviewWorkflowNode, nodeKeys: Set<string>) {
  return node.parentNodeKey && nodeKeys.has(node.parentNodeKey) ? node.parentNodeKey : null;
}

function aggregateBridgeSources(sorted: ReviewWorkflowNode[], nodeKeys: Set<string>) {
  return sorted.filter((node) => (
    node.nodeKey.startsWith("pi:")
    && resolveParentNodeKey(node, nodeKeys) === RUN_PI_RUNTIME_NODE_KEY
  ));
}

export function buildWorkflowGraph(nodes: ReviewWorkflowNode[]) {
  const sorted = [...nodes].sort((left, right) => (
    left.sequence - right.sequence || left.createdAt.getTime() - right.createdAt.getTime()
  ));
  const nodeKeys = new Set(sorted.map((node) => node.nodeKey));
  const edgeMap = new Map<string, WorkflowGraphEdge>();
  const bridgeSources = aggregateBridgeSources(sorted, nodeKeys);
  let previousMainNode: ReviewWorkflowNode | null = null;

  sorted.forEach((node) => {
    const parentNodeKey = resolveParentNodeKey(node, nodeKeys);

    if (parentNodeKey) {
      const edge: WorkflowGraphEdge = {
        id: `${parentNodeKey}->${node.nodeKey}`,
        source: parentNodeKey,
        target: node.nodeKey,
        label: edgeLabel(node),
        kind: node.kind === "iteration_stage" ? "loop" : "parent",
      };
      edgeMap.set(edge.id, edge);
      return;
    }

    if (node.parentNodeKey) return;

    if (node.nodeKey === AGGREGATE_NODE_KEY && bridgeSources.length > 0) {
      bridgeSources.forEach((sourceNode) => {
        const edge: WorkflowGraphEdge = {
          id: `${sourceNode.nodeKey}->${node.nodeKey}`,
          source: sourceNode.nodeKey,
          target: node.nodeKey,
          label: edgeLabel(node),
          kind: "main",
        };
        edgeMap.set(edge.id, edge);
      });
      previousMainNode = node;
      return;
    }

    const previous = previousMainNode;
    previousMainNode = node;
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
