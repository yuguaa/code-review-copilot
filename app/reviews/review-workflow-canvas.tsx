'use client'

import { useMemo } from 'react'
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react'
import type {
  ReviewWorkflowEdge,
  ReviewWorkflowNode,
  ReviewWorkflowSnapshot,
} from './review-workflow-types'

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

const kindLabel: Record<string, string> = {
  trigger: '触发',
  diff: 'Diff',
  memory: 'Memory',
  summary: '摘要',
  agent: 'Agent',
  decision: '决策',
  iteration_stage: 'Loop',
  aggregate: '聚合',
  publish: '发布',
  finish: '结束',
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
          {kindLabel[node.kind] || node.kind}
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

function nodePosition(node: ReviewWorkflowNode, index: number) {
  const isAgentDetail = node.kind === 'iteration_stage' || node.kind === 'decision'
  const column = isAgentDetail ? Math.max(1, Math.floor((node.sequence - 420) / 30)) : index
  const x = isAgentDetail ? (column % 5) * 280 : (index % 5) * 280
  const y = isAgentDetail ? 220 + Math.floor(column / 5) * 170 : Math.floor(index / 5) * 170
  return { x, y }
}

function toReactFlowNodes(
  workflowNodes: ReviewWorkflowNode[],
  selectedNodeKey: string | null,
): Node[] {
  return workflowNodes.map((node, index) => {
    const style = statusStyles[node.status] || statusStyles.idle
    const selected = selectedNodeKey === node.nodeKey
    return {
      id: node.nodeKey,
      data: { label: nodeLabel(node) },
      position: nodePosition(node, index),
      className: selected ? 'shadow-[0_0_0_3px_rgba(204,120,92,0.25)]' : undefined,
      style: {
        width: 240,
        minHeight: 92,
        borderRadius: 10,
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
    <div className="h-[520px] min-h-0 overflow-hidden rounded-lg border border-border/60 bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        fitView
        fitViewOptions={{ padding: 0.18 }}
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
