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

const RUN_AGENTS_NODE_KEY = "run_agents";
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

function fallbackAgentParentKey(node: ReviewWorkflowNode, nodeKeys: Set<string>) {
  if (!node.nodeKey.startsWith("agent:")) return null;
  const parts = node.nodeKey.split(":");
  const botRunId = parts[1];
  if (!botRunId) return null;

  const iterationIndex = parts.indexOf("iteration");
  if (iterationIndex === -1) {
    return nodeKeys.has(RUN_AGENTS_NODE_KEY) ? RUN_AGENTS_NODE_KEY : null;
  }

  const iteration = parts[iterationIndex + 1];
  const stage = node.kind === "decision"
    ? "decision"
    : parts[iterationIndex + 2];
  const stageKey = (candidate: string) => `agent:${botRunId}:iteration:${iteration}:${candidate}`;
  const existingKey = (candidate: string) => nodeKeys.has(candidate) ? candidate : null;
  const firstExisting = (candidates: string[]) => candidates.find((candidate) => nodeKeys.has(candidate)) || null;

  if (stage === "initializing") return existingKey(`agent:${botRunId}`);
  if (stage === "context") return existingKey(stageKey("initializing"));
  if (stage === "plan") return existingKey(stageKey("context"));
  if (stage === "review") return existingKey(stageKey("plan"));
  if (stage === "validation") return existingKey(stageKey("review"));
  if (stage === "decision") return firstExisting([stageKey("validation"), stageKey("plan")]);
  if (stage === "tool") return firstExisting([stageKey("decision:additional_agents"), stageKey("validation")]);
  if (stage === "critic") return firstExisting([stageKey("tool"), stageKey("decision:additional_agents"), stageKey("validation")]);
  if (stage === "finish" || stage === "error") return firstExisting([stageKey("critic"), stageKey("validation")]);
  return null;
}

function resolveParentNodeKey(node: ReviewWorkflowNode, nodeKeys: Set<string>) {
  return node.parentNodeKey && nodeKeys.has(node.parentNodeKey)
    ? node.parentNodeKey
    : fallbackAgentParentKey(node, nodeKeys);
}

function agentBotRunId(node: ReviewWorkflowNode) {
  if (!node.nodeKey.startsWith("agent:")) return null;
  return node.nodeKey.split(":")[1] || null;
}

function agentLoopStage(node: ReviewWorkflowNode) {
  if (!node.nodeKey.startsWith("agent:")) return null;
  const parts = node.nodeKey.split(":");
  const iterationIndex = parts.indexOf("iteration");
  if (iterationIndex === -1) return null;
  if (node.kind === "decision") return "decision";
  return parts[iterationIndex + 2] || null;
}

function isAgentRootNode(node: ReviewWorkflowNode) {
  return node.nodeKey.startsWith("agent:") && !node.nodeKey.includes(":iteration:");
}

function isAgentLoopTerminalNode(node: ReviewWorkflowNode) {
  const stage = agentLoopStage(node);
  return stage === "finish" || stage === "error";
}

function latestNode(left: ReviewWorkflowNode, right: ReviewWorkflowNode) {
  if (left.sequence !== right.sequence) return left.sequence > right.sequence ? left : right;
  return left.createdAt > right.createdAt ? left : right;
}

function aggregateBridgeSources(sorted: ReviewWorkflowNode[], nodeKeys: Set<string>) {
  const primaryAgentRoots = sorted.filter((node) => (
    isAgentRootNode(node) && resolveParentNodeKey(node, nodeKeys) === RUN_AGENTS_NODE_KEY
  ));
  const primaryBotRunIds = new Set(primaryAgentRoots.map(agentBotRunId).filter(Boolean));
  if (primaryBotRunIds.size === 0) return [];

  const terminalByBotRunId = new Map<string, ReviewWorkflowNode>();
  sorted.forEach((node) => {
    const botRunId = agentBotRunId(node);
    if (!botRunId || !primaryBotRunIds.has(botRunId) || !isAgentLoopTerminalNode(node)) return;
    const current = terminalByBotRunId.get(botRunId);
    terminalByBotRunId.set(botRunId, current ? latestNode(current, node) : node);
  });

  if (terminalByBotRunId.size > 0) {
    return [...terminalByBotRunId.values()].sort((left, right) => (
      left.sequence - right.sequence || left.createdAt.getTime() - right.createdAt.getTime()
    ));
  }

  return primaryAgentRoots;
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

    if (node.parentNodeKey || node.nodeKey.startsWith("agent:")) return;

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
