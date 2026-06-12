'use client'

import { useMemo } from 'react'
import {
  Background,
  Controls,
  MarkerType,
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
  compact?: boolean
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

function isRuntimeNode(node: ReviewWorkflowNode) {
  return node.nodeKey.startsWith('pi:')
}

function buildNodePositions(workflowNodes: ReviewWorkflowNode[]) {
  const mainNodes = workflowNodes.filter((node) => !isRuntimeNode(node))
  const runtimeNodes = workflowNodes.filter(isRuntimeNode)

  const runPiRuntimeIndex = mainNodes.findIndex((node) => node.nodeKey === 'run_pi_runtime')
  const runtimeSpace = runPiRuntimeIndex === -1 || runtimeNodes.length === 0
    ? 0
    : Math.max(0, runtimeNodes.length - 1) * loopGapY

  const positions = new Map<string, { x: number; y: number }>()

  mainNodes.forEach((node, index) => {
    const shiftAfterRuntime = runPiRuntimeIndex !== -1 && index > runPiRuntimeIndex ? runtimeSpace : 0
    positions.set(node.nodeKey, {
      x: mainLaneX,
      y: topOffset + index * mainGapY + shiftAfterRuntime,
    })
  })

  const runtimeBaseY = positions.get('run_pi_runtime')?.y ?? (topOffset + Math.max(1, mainNodes.length) * mainGapY)
  runtimeNodes.forEach((node, index) => {
    positions.set(node.nodeKey, {
      x: loopLaneX + index * loopGapX,
      y: runtimeBaseY,
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
    const runtimeNode = isRuntimeNode(node)
    return {
      id: node.nodeKey,
      data: { label: nodeLabel(node) },
      position: positions.get(node.nodeKey) || { x: mainLaneX, y: topOffset },
      sourcePosition: Position.Bottom,
      targetPosition: runtimeNode ? Position.Left : Position.Top,
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
  compact = false,
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
    <div className={`${compact ? 'h-72' : 'h-[min(70vh,780px)] min-h-[640px]'} overflow-hidden rounded-lg border border-border/60 bg-background`}>
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
        <Controls />
        <Background />
      </ReactFlow>
    </div>
  )
}
