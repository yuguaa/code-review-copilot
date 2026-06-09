'use client'

import { useMemo } from 'react'
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react'
import type {
  ReviewWorkflowEdge,
  ReviewWorkflowNode,
  ReviewWorkflowSnapshot,
} from './review-workflow-types'
import { reviewWorkflowKindLabels } from './review-workflow-types'

type ReviewWorkflowCanvasProps = {
  workflow: ReviewWorkflowSnapshot
  selectedNodeKey: string | null
  onSelectNode: (node: ReviewWorkflowNode) => void
}

const statusStyles: Record<string, { background: string; border: string; color: string }> = {
  running: { background: '#fff7ed', border: '#f97316', color: '#9a3412' },
  success: { background: '#ecfdf5', border: '#10b981', color: '#065f46' },
  warning: { background: '#fffbeb', border: '#f59e0b', color: '#92400e' },
  failed: { background: '#fef2f2', border: '#ef4444', color: '#991b1b' },
  cancelled: { background: '#f1f5f9', border: '#64748b', color: '#334155' },
  skipped: { background: '#f8fafc', border: '#cbd5e1', color: '#64748b' },
  idle: { background: '#ffffff', border: '#d6d3d1', color: '#57534e' },
}

const nodeWidth = 240
const mainLaneX = 40
const loopLaneX = 360
const topOffset = 36
const mainGapY = 150
const loopGapX = 300
const loopGapY = 150

const loopStageOrder: Record<string, number> = {
  agent: 0,
  initializing: 1,
  context: 2,
  plan: 3,
  decision: 4,
  tool: 5,
  review: 6,
  validation: 7,
  critic: 8,
  finish: 9,
  error: 10,
}

function formatDuration(durationMs: number | null) {
  if (!durationMs) return ''
  if (durationMs < 1000) return `${durationMs}ms`
  const seconds = Math.round(durationMs / 100) / 10
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

function nodeLabel(node: ReviewWorkflowNode) {
  const duration = formatDuration(node.durationMs)
  return (
    <div className="w-[220px] text-left">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
          {reviewWorkflowKindLabels[node.kind] || node.kind}
        </span>
        <span className="text-[10px] font-mono opacity-70">{node.status}</span>
      </div>
      <div className="mt-1 truncate text-sm font-semibold">{node.title}</div>
      {node.summary && (
        <div className="mt-1 line-clamp-2 text-xs leading-4 opacity-80">{node.summary}</div>
      )}
      {duration && (
        <div className="mt-2 text-[10px] font-mono opacity-60">{duration}</div>
      )}
    </div>
  )
}

function getLoopNodeInfo(node: ReviewWorkflowNode) {
  if (!node.nodeKey.startsWith('agent:')) return null
  const parts = node.nodeKey.split(':')
  const agentId = parts[1]
  if (!agentId) return null

  const iterationIndex = parts.indexOf('iteration')
  if (iterationIndex === -1) {
    return {
      agentId,
      iteration: 1,
      stage: 'agent',
      stageIndex: loopStageOrder.agent,
    }
  }

  const iteration = Number(parts[iterationIndex + 1]) || 1
  const stage = node.kind === 'decision'
    ? 'decision'
    : parts[iterationIndex + 2] || node.kind

  return {
    agentId,
    iteration,
    stage,
    stageIndex: loopStageOrder[stage] ?? 99,
  }
}

function isLoopNode(node: ReviewWorkflowNode) {
  return Boolean(getLoopNodeInfo(node))
}

function buildNodePositions(workflowNodes: ReviewWorkflowNode[]) {
  const mainNodes = workflowNodes.filter((node) => !isLoopNode(node))
  const loopNodes = workflowNodes
    .map((node) => ({ node, info: getLoopNodeInfo(node) }))
    .filter((item): item is { node: ReviewWorkflowNode; info: NonNullable<ReturnType<typeof getLoopNodeInfo>> } => Boolean(item.info))

  const runAgentsIndex = mainNodes.findIndex((node) => node.nodeKey === 'run_agents')
  const agentGroups = new Map<string, { firstSequence: number; maxIteration: number }>()
  loopNodes.forEach(({ node, info }) => {
    const current = agentGroups.get(info.agentId)
    agentGroups.set(info.agentId, {
      firstSequence: Math.min(current?.firstSequence ?? node.sequence, node.sequence),
      maxIteration: Math.max(current?.maxIteration ?? 1, info.iteration),
    })
  })

  const sortedAgentGroups = [...agentGroups.entries()].sort((left, right) => (
    left[1].firstSequence - right[1].firstSequence
  ))
  const agentRowStart = new Map<string, number>()
  let loopRowCount = 0
  sortedAgentGroups.forEach(([agentId, group]) => {
    agentRowStart.set(agentId, loopRowCount)
    loopRowCount += group.maxIteration
  })

  const loopSpace = runAgentsIndex === -1 ? 0 : Math.max(0, loopRowCount - 1) * loopGapY + (loopRowCount > 0 ? loopGapY : 0)
  const positions = new Map<string, { x: number; y: number }>()

  mainNodes.forEach((node, index) => {
    const shiftAfterLoop = runAgentsIndex !== -1 && index > runAgentsIndex ? loopSpace : 0
    positions.set(node.nodeKey, {
      x: mainLaneX,
      y: topOffset + index * mainGapY + shiftAfterLoop,
    })
  })

  const loopBaseY = positions.get('run_agents')?.y ?? (topOffset + Math.max(1, mainNodes.length) * mainGapY)
  loopNodes.forEach(({ node, info }) => {
    const groupStart = agentRowStart.get(info.agentId) ?? 0
    positions.set(node.nodeKey, {
      x: loopLaneX + info.stageIndex * loopGapX,
      y: loopBaseY + (groupStart + info.iteration - 1) * loopGapY,
    })
  })

  return positions
}

function toReactFlowNodes(
  workflowNodes: ReviewWorkflowNode[],
  selectedNodeKey: string | null,
): Node[] {
  const positions = buildNodePositions(workflowNodes)
  return workflowNodes.map((node) => {
    const style = statusStyles[node.status] || statusStyles.idle
    const selected = selectedNodeKey === node.nodeKey
    const loopNode = isLoopNode(node)
    return {
      id: node.nodeKey,
      data: { label: nodeLabel(node) },
      position: positions.get(node.nodeKey) || { x: mainLaneX, y: topOffset },
      sourcePosition: loopNode || node.nodeKey === 'run_agents' ? Position.Right : Position.Bottom,
      targetPosition: loopNode ? Position.Left : Position.Top,
      className: selected ? 'shadow-[0_0_0_3px_rgba(204,120,92,0.25)]' : undefined,
      style: {
        width: nodeWidth,
        minHeight: 92,
        borderRadius: 8,
        border: `1.5px solid ${style.border}`,
        background: style.background,
        color: style.color,
        padding: 10,
      },
    }
  })
}

function toReactFlowEdges(workflowEdges: ReviewWorkflowEdge[], nodes: ReviewWorkflowNode[]): Edge[] {
  const runningNodeKeys = new Set(nodes.filter((node) => node.status === 'running').map((node) => node.nodeKey))
  return workflowEdges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    type: 'smoothstep',
    animated: runningNodeKeys.has(edge.target),
    markerEnd: {
      type: MarkerType.ArrowClosed,
    },
    style: {
      strokeWidth: edge.kind === 'main' ? 2 : 1.5,
      stroke: edge.kind === 'main' ? '#78716c' : '#a8a29e',
    },
    labelStyle: {
      fontSize: 11,
      fill: '#57534e',
    },
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 4,
  }))
}

export function ReviewWorkflowCanvas({
  workflow,
  selectedNodeKey,
  onSelectNode,
}: ReviewWorkflowCanvasProps) {
  const nodes = useMemo(
    () => toReactFlowNodes(workflow.nodes, selectedNodeKey),
    [selectedNodeKey, workflow.nodes],
  )
  const edges = useMemo(
    () => toReactFlowEdges(workflow.edges, workflow.nodes),
    [workflow.edges, workflow.nodes],
  )
  const nodeMap = useMemo(() => new Map(workflow.nodes.map((node) => [node.nodeKey, node])), [workflow.nodes])

  return (
    <div className="h-[620px] min-h-0 overflow-hidden rounded-lg border border-border/60 bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        fitView
        fitViewOptions={{ padding: 0.2 }}
        onNodeClick={(_, node) => {
          const matched = nodeMap.get(node.id)
          if (matched) onSelectNode(matched)
        }}
      >
        <MiniMap zoomable pannable />
        <Controls />
        <Background />
      </ReactFlow>
    </div>
  )
}
