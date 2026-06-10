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
import {
  compactWorkflowText,
  getWorkflowNodeMessage,
  reviewWorkflowKindLabels,
} from './review-workflow-types'

type ReviewWorkflowCanvasProps = {
  workflow: ReviewWorkflowSnapshot
  selectedNodeKey: string | null
  onSelectNode: (node: ReviewWorkflowNode) => void
}

const statusStyles: Record<string, { background: string; border: string; color: string }> = {
  running: { background: '#fff7ed', border: '#cc785c', color: '#8a3d25' },
  success: { background: '#f2fbf7', border: '#5db872', color: '#1f6b3b' },
  warning: { background: '#fff8e6', border: '#d4a017', color: '#7a5600' },
  failed: { background: '#fff1f1', border: '#c64545', color: '#8d2323' },
  cancelled: { background: '#f5f0e8', border: '#cfc7bb', color: '#6c6a64' },
  skipped: { background: '#faf9f5', border: '#d8d0c5', color: '#6c6a64' },
  idle: { background: '#fffdf8', border: '#d8d0c5', color: '#57534e' },
}

const statusLabels: Record<string, string> = {
  running: '运行中',
  success: '成功',
  warning: '警告',
  failed: '失败',
  cancelled: '取消',
  skipped: '跳过',
  idle: '等待',
}

const nodeWidth = 226
const nodeHeight = 102
const mainLaneX = 44
const loopLaneX = 340
const topOffset = 36
const mainGapY = 132
const loopGapX = 286
const loopGapY = 126

const loopStageOrder: Record<string, number> = {
  agent: 0,
  initializing: 1,
  context: 2,
  plan: 3,
  review: 4,
  validation: 5,
  decision: 6,
  tool: 7,
  critic: 8,
  finish: 9,
  error: 9,
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
  const message = compactWorkflowText(getWorkflowNodeMessage(node), 54)
  return (
    <div className="w-[210px] text-left">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium opacity-70">
          {reviewWorkflowKindLabels[node.kind] || node.kind}
        </span>
        <span className="rounded-full bg-white/55 px-1.5 py-0.5 text-[10px] font-medium opacity-80">
          {statusLabels[node.status] || node.status}
        </span>
      </div>
      <div className="mt-1.5 truncate text-sm font-semibold">{node.title}</div>
      {message && (
        <div className="mt-1 truncate text-xs leading-4 opacity-80">{message}</div>
      )}
      {duration && (
        <div className="mt-2 font-mono text-[10px] opacity-60">{duration}</div>
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
  const agentColumnIndex = new Map<string, number>()
  sortedAgentGroups.forEach(([agentId]) => {
    agentColumnIndex.set(agentId, agentColumnIndex.size)
  })

  const loopStageCount = Math.max(...Object.values(loopStageOrder)) + 1
  const loopRows = loopNodes.reduce((maxRows, { info }) => {
    const row = (info.iteration - 1) * loopStageCount + info.stageIndex + 1
    return Math.max(maxRows, row)
  }, 0)
  const loopSpace = runAgentsIndex === -1 || loopRows === 0
    ? 0
    : (loopRows - 1) * loopGapY

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
    const columnIndex = agentColumnIndex.get(info.agentId) ?? 0
    const iterationOffset = (info.iteration - 1) * loopStageCount
    positions.set(node.nodeKey, {
      x: loopLaneX + columnIndex * loopGapX,
      y: loopBaseY + (iterationOffset + info.stageIndex) * loopGapY,
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
      sourcePosition: Position.Bottom,
      targetPosition: loopNode && node.nodeKey.split(':').length === 2 ? Position.Left : Position.Top,
      className: selected ? 'shadow-[0_0_0_3px_rgba(204,120,92,0.22)]' : undefined,
      style: {
        width: nodeWidth,
        height: nodeHeight,
        borderRadius: 8,
        border: `1.5px solid ${style.border}`,
        background: style.background,
        color: style.color,
        padding: 10,
        overflow: 'hidden',
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
      width: 16,
      height: 16,
    },
    style: {
      strokeWidth: edge.kind === 'main' ? 2 : 1.6,
      stroke: edge.kind === 'main' ? '#6c6a64' : '#b7afa4',
    },
    labelStyle: {
      fontSize: 11,
      fill: '#3d3d3a',
    },
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 4,
    labelBgStyle: {
      fill: '#fffdf8',
      fillOpacity: 0.92,
    },
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
    <div className="h-[min(70vh,780px)] min-h-[640px] overflow-hidden rounded-lg border border-border/60 bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        fitView
        fitViewOptions={{ padding: 0.16 }}
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
