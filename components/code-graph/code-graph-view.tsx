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

export type CodeGraphViewSymbol = {
  id: string
  filePath: string
  name: string
  kind: string
  signature: string | null
  startLine: number
  endLine: number
  summary: string
}

export type CodeGraphViewRelation = {
  id: string
  from: string
  to: string | null
  fromSymbol: { name: string; kind: string } | null
  toSymbol: { name: string; kind: string } | null
  relationType: string
  confidence: number
  evidence: string
}

type CodeGraphViewProps = {
  files: CodeGraphViewFile[]
  symbols: CodeGraphViewSymbol[]
  relations: CodeGraphViewRelation[]
  selectedFilePath: string | null
  onSelectFile: (filePath: string) => void
}

const roleColors: Record<string, string> = {
  api_route: '#dc2626',
  page: '#ea580c',
  component: '#0891b2',
  service: '#2563eb',
  agent_step: '#7c3aed',
  review_step: '#9333ea',
  review_core: '#a855f7',
  data_model: '#16a34a',
  hook: '#0d9488',
  script: '#64748b',
  project_config: '#ca8a04',
  module: '#475569',
  symbol: '#f8fafc',
}

const shortFileName = (filePath: string) => {
  const parts = filePath.split('/')
  return parts[parts.length - 1] || filePath
}

const symbolPrefix = (kind: string) => {
  if (kind === 'class') return 'C'
  if (kind === 'interface') return 'I'
  if (kind === 'enum') return 'E'
  if (kind === 'record') return 'R'
  return 'ƒ'
}

const symbolColor = (kind: string) => {
  if (kind === 'class' || kind === 'record') return '#1d4ed8'
  if (kind === 'interface') return '#0f766e'
  if (kind === 'enum') return '#a16207'
  return '#334155'
}

const buildGraphData = (
  files: CodeGraphViewFile[],
  symbols: CodeGraphViewSymbol[],
  relations: CodeGraphViewRelation[],
  selectedFilePath: string | null,
): RGJsonData => {
  const relationFilePaths = new Set<string>()
  relations.forEach((relation) => {
    relationFilePaths.add(relation.from)
    if (relation.to) relationFilePaths.add(relation.to)
  })
  const selectedFile = selectedFilePath ? files.find((file) => file.filePath === selectedFilePath) : null
  const relatedFilePaths = selectedFilePath
    ? new Set(relations
      .filter((relation) => relation.from === selectedFilePath || relation.to === selectedFilePath)
      .flatMap((relation) => [relation.from, relation.to].filter((item): item is string => Boolean(item))))
    : new Set<string>()
  const visibleFiles = [
    ...(selectedFile ? [selectedFile] : []),
    ...files.filter((file) => relatedFilePaths.has(file.filePath)),
    ...files.filter((file) => relationFilePaths.has(file.filePath)),
    ...files,
  ].filter((file, index, allFiles) => allFiles.findIndex((item) => item.filePath === file.filePath) === index).slice(0, 120)
  const visibleFilePaths = new Set(visibleFiles.map((file) => file.filePath))
  const visibleSymbols = symbols
    .filter((symbol) => visibleFilePaths.has(symbol.filePath))
    .slice(0, 180)
  const fileNodes: JsonNode[] = visibleFiles.map((file) => {
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
  const symbolNodes: JsonNode[] = visibleSymbols.map((symbol) => ({
    id: `symbol:${symbol.id}`,
    text: `${symbolPrefix(symbol.kind)} ${symbol.name}`,
    color: symbolColor(symbol.kind),
    borderColor: '#94a3b8',
    borderWidth: 1,
    fontColor: '#f8fafc',
    width: 88,
    height: 24,
    nodeShape: RGNodeShape.rect,
    borderRadius: 999,
    data: symbol,
  }))
  const nodes: JsonNode[] = [...fileNodes, ...symbolNodes]
  const relationLines: JsonLine[] = relations
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
  const symbolLines: JsonLine[] = visibleSymbols.map((symbol) => ({
      id: `contains:${symbol.id}`,
      from: symbol.filePath,
      to: `symbol:${symbol.id}`,
      text: symbol.kind,
      color: '#475569',
      fontColor: '#64748b',
      lineWidth: 1,
      opacity: selectedFilePath === symbol.filePath ? 0.6 : 0.24,
      lineShape: RGLineShape.StandardCurve,
      showEndArrow: false,
      useTextOnPath: false,
      data: symbol,
    }))
  const lines: JsonLine[] = [...relationLines, ...symbolLines]

  return {
    rootId: selectedFilePath && visibleFilePaths.has(selectedFilePath) ? selectedFilePath : visibleFiles[0]?.filePath,
    nodes,
    lines,
  }
}

const graphOptions: RGOptions = {
  backgroundColor: '#0b1120',
  defaultNodeShape: RGNodeShape.rect,
  defaultLineShape: RGLineShape.StandardCurve,
  defaultLineTextOnPath: true,
  defaultNodeBorderRadius: 10,
  defaultNodeWidth: 84,
  defaultNodeHeight: 36,
  defaultLineColor: '#94a3b8',
  defaultLineWidth: 1,
  lineTextMaxLength: 18,
  showToolBar: true,
  toolBarDirection: 'h',
  toolBarPositionH: 'right',
  toolBarPositionV: 'top',
  wheelEventAction: 'zoom',
  defaultExpandHolderPosition: 'hide',
  performanceMode: true,
  checkedNodeId: '',
  minCanvasZoom: 8,
  maxCanvasZoom: 240,
  layout: {
    layoutName: 'center',
    distanceCoefficient: 1.8,
    maxLayoutTimes: 320,
    force_node_repulsion: 2,
    force_line_elastic: 0.4,
  },
}

function CodeGraphCanvas({ files, symbols, relations, selectedFilePath, onSelectFile }: CodeGraphViewProps) {
  const graphInstance = RGHooks.useGraphInstance()
  const graphData = useMemo(
    () => buildGraphData(files, symbols, relations, selectedFilePath),
    [files, relations, selectedFilePath, symbols],
  )

  useEffect(() => {
    graphInstance
      .setJsonData(graphData)
      .then(() => {
        graphInstance.moveToCenter()
        graphInstance.setZoom(60)
      })
  }, [graphData, graphInstance])

  const handleNodeClick = (node: RGNode) => {
    const symbolFilePath = typeof node.data?.filePath === 'string' ? node.data.filePath : null
    onSelectFile(node.id.startsWith('symbol:') && symbolFilePath ? symbolFilePath : node.id)
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
    <div className="h-[520px] overflow-hidden rounded-xl border border-slate-200 bg-slate-950 shadow-sm">
      <RGProvider>
        <CodeGraphCanvas {...props} />
      </RGProvider>
    </div>
  )
}
