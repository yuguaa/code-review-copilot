'use client'

import { useEffect, useMemo } from 'react'
import {
  RelationGraph,
  RGProvider,
  RGHooks,
  RGMiniView,
  RGNodeShape,
  RGLineShape,
  RGSlotOnView,
} from '@relation-graph/react'
import type { JsonLine, JsonNode, RGJsonData, RGNode, RGOptions } from '@relation-graph/react'

export type CodeGraphViewFile = {
  id: string
  filePath: string
  role: string
  language: string
  summary: string
}

export type CodeGraphViewRelation = {
  id: string
  from: string
  to: string | null
  relationType: string
  confidence: number
  evidence: string
}

type CodeGraphViewProps = {
  files: CodeGraphViewFile[]
  relations: CodeGraphViewRelation[]
  selectedFilePath: string | null
  onSelectFile: (filePath: string) => void
}

const roleColors: Record<string, string> = {
  api_route: '#ef4444',
  page: '#f97316',
  component: '#06b6d4',
  service: '#2563eb',
  workflow_node: '#7c3aed',
  review_workflow: '#9333ea',
  data_model: '#16a34a',
  hook: '#0d9488',
  script: '#64748b',
  project_config: '#ca8a04',
  module: '#475569',
}

const shortFileName = (filePath: string) => {
  const parts = filePath.split('/')
  return parts[parts.length - 1] || filePath
}

const buildGraphData = (
  files: CodeGraphViewFile[],
  relations: CodeGraphViewRelation[],
  selectedFilePath: string | null,
): RGJsonData => {
  const visibleFiles = files.slice(0, 120)
  const visibleFilePaths = new Set(visibleFiles.map((file) => file.filePath))
  const nodes: JsonNode[] = visibleFiles.map((file) => {
    const selected = selectedFilePath === file.filePath
    return {
      id: file.filePath,
      text: shortFileName(file.filePath),
      color: roleColors[file.role] || roleColors.module,
      borderColor: selected ? '#f8fafc' : '#1e293b',
      borderWidth: selected ? 4 : 1,
      fontColor: selected ? '#f8fafc' : '#cbd5e1',
      width: selected ? 96 : 84,
      height: selected ? 42 : 36,
      nodeShape: RGNodeShape.rect,
      borderRadius: 10,
      data: file,
    }
  })
  const lines: JsonLine[] = relations
    .filter((relation) => relation.to && visibleFilePaths.has(relation.from) && visibleFilePaths.has(relation.to))
    .slice(0, 240)
    .map((relation) => {
      const selected = selectedFilePath && (relation.from === selectedFilePath || relation.to === selectedFilePath)
      return {
        id: relation.id,
        from: relation.from,
        to: relation.to || '',
        text: relation.relationType,
        color: selected ? '#facc15' : '#64748b',
        fontColor: selected ? '#fde68a' : '#94a3b8',
        lineWidth: selected ? 2 : 1,
        opacity: selected ? 1 : 0.5,
        lineShape: RGLineShape.StandardCurve,
        showEndArrow: true,
        useTextOnPath: true,
        data: relation,
      }
    })

  return {
    rootId: selectedFilePath && visibleFilePaths.has(selectedFilePath) ? selectedFilePath : visibleFiles[0]?.filePath,
    nodes,
    lines,
  }
}

const graphOptions: RGOptions = {
  backgroundColor: '#020617',
  defaultNodeShape: RGNodeShape.rect,
  defaultLineShape: RGLineShape.StandardCurve,
  defaultLineTextOnPath: true,
  defaultNodeBorderRadius: 10,
  defaultNodeWidth: 84,
  defaultNodeHeight: 36,
  defaultLineColor: '#64748b',
  defaultLineWidth: 1,
  lineTextMaxLength: 18,
  showToolBar: true,
  toolBarDirection: 'h',
  toolBarPositionH: 'right',
  toolBarPositionV: 'top',
  wheelEventAction: 'zoom',
  layout: {
    layoutName: 'force',
    fastStart: true,
    maxLayoutTimes: 180,
    force_node_repulsion: 1.4,
    force_line_elastic: 0.6,
  },
}

function CodeGraphCanvas({ files, relations, selectedFilePath, onSelectFile }: CodeGraphViewProps) {
  const graphInstance = RGHooks.useGraphInstance()
  const graphData = useMemo(
    () => buildGraphData(files, relations, selectedFilePath),
    [files, relations, selectedFilePath],
  )

  useEffect(() => {
    graphInstance
      .setJsonData(graphData)
      .then(() => {
        graphInstance.moveToCenter()
        graphInstance.zoomToFit()
      })
  }, [graphData, graphInstance])

  const handleNodeClick = (node: RGNode) => {
    onSelectFile(node.id)
    return true
  }

  return (
    <RelationGraph options={graphOptions} onNodeClick={handleNodeClick}>
      <RGSlotOnView>
        <RGMiniView />
      </RGSlotOnView>
    </RelationGraph>
  )
}

export function CodeGraphView(props: CodeGraphViewProps) {
  return (
    <div className="h-[420px] overflow-hidden rounded-lg border bg-slate-950">
      <RGProvider>
        <CodeGraphCanvas {...props} />
      </RGProvider>
    </div>
  )
}
