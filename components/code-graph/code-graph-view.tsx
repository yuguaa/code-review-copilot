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

export type CodeGraphDbFile = {
  path: string
  content_hash: string
  language: string
  size: number
  modified_at: number
  indexed_at: number
  node_count: number
  errors: string | null
}

export type CodeGraphDbNode = {
  id: string
  kind: string
  name: string
  qualified_name: string
  file_path: string
  language: string
  start_line: number
  end_line: number
  start_column: number
  end_column: number
  docstring: string | null
  signature: string | null
  visibility: string | null
  is_exported: number
  is_async: number
  is_static: number
  is_abstract: number
  decorators: string | null
  type_parameters: string | null
  updated_at: number
}

export type CodeGraphDbEdge = {
  source: string
  target: string
  kind: string
  metadata: string | null
  line: number | null
  col: number | null
  provenance: string | null
}

export type CodeGraphDb = {
  schema_versions: Array<{ version: number; applied_at: number; description: string }>
  files: CodeGraphDbFile[]
  nodes: CodeGraphDbNode[]
  edges: CodeGraphDbEdge[]
  unresolved_refs: Array<Record<string, unknown>>
  project_metadata: Array<Record<string, unknown>>
}

type CodeGraphViewProps = {
  files: CodeGraphViewFile[]
  symbols: CodeGraphViewSymbol[]
  relations: CodeGraphViewRelation[]
  codegraphDb?: CodeGraphDb | null
  selectedFilePath: string | null
  onSelectFile: (filePath: string) => void
}

const roleColors: Record<string, string> = {
  api_route: '#dc2626',
  page: '#ea580c',
  component: '#0891b2',
  service: '#2563eb',
  runtime_step: '#7c3aed',
  review_step: '#9333ea',
  review_core: '#a855f7',
  data_model: '#16a34a',
  hook: '#0d9488',
  script: '#64748b',
  project_config: '#ca8a04',
  module: '#475569',
  symbol: '#f8fafc',
  import: '#0f172a',
  file: '#475569',
}

const kindColors: Record<string, string> = {
  file: '#475569',
  import: '#111827',
  component: '#0891b2',
  function: '#2563eb',
  method: '#4f46e5',
  class: '#7c3aed',
  interface: '#0f766e',
  type_alias: '#0d9488',
  constant: '#ca8a04',
  variable: '#64748b',
  property: '#64748b',
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

const nodeText = (node: CodeGraphDbNode) => {
  if (node.kind === 'file') return shortFileName(node.file_path)
  if (node.kind === 'import') return `↗ ${node.name}`
  return `${symbolPrefix(node.kind)} ${node.name}`
}

const buildCodegraphDbGraphData = (
  codegraphDb: CodeGraphDb,
  selectedFilePath: string | null,
): RGJsonData => {
  const selectedNodeIds = selectedFilePath
    ? new Set(codegraphDb.nodes.filter((node) => node.file_path === selectedFilePath).map((node) => node.id))
    : new Set<string>()
  const relationNodeIds = new Set<string>()

  codegraphDb.edges.forEach((edge) => {
    if (edge.kind === 'contains') return
    relationNodeIds.add(edge.source)
    relationNodeIds.add(edge.target)
    if (selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target)) {
      relationNodeIds.add(edge.source)
      relationNodeIds.add(edge.target)
    }
  })

  const visibleNodes = [
    ...codegraphDb.nodes.filter((node) => selectedNodeIds.has(node.id)),
    ...codegraphDb.nodes.filter((node) => relationNodeIds.has(node.id)),
    ...codegraphDb.nodes.filter((node) => node.kind === 'file'),
    ...codegraphDb.nodes,
  ].filter((node, index, allNodes) => allNodes.findIndex((item) => item.id === node.id) === index).slice(0, 180)
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id))
  const graphNodes: JsonNode[] = visibleNodes.map((node) => {
    const selected = selectedFilePath === node.file_path
    return {
      id: node.id,
      text: nodeText(node),
      color: kindColors[node.kind] || '#334155',
      borderColor: selected ? '#f8fafc' : node.kind === 'import' ? '#334155' : '#1e293b',
      borderWidth: selected ? 3 : 1,
      fontColor: '#f8fafc',
      width: node.kind === 'import' ? 110 : node.kind === 'file' ? 92 : 96,
      height: node.kind === 'import' || node.kind !== 'file' ? 28 : 38,
      nodeShape: RGNodeShape.rect,
      borderRadius: node.kind === 'file' ? 10 : 999,
      data: node,
    }
  })
  const graphLines: JsonLine[] = codegraphDb.edges
    .filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
    .slice(0, 320)
    .map((edge, index) => {
      const selected = selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target)
      return {
        id: `${edge.source}:${edge.target}:${edge.kind}:${index}`,
        from: edge.source,
        to: edge.target,
        text: edge.kind,
        color: selected ? '#facc15' : edge.kind === 'contains' ? '#475569' : '#64748b',
        fontColor: selected ? '#fde68a' : '#94a3b8',
        lineWidth: selected ? 2 : 1,
        opacity: edge.kind === 'contains' ? 0.26 : selected ? 1 : 0.55,
        lineShape: RGLineShape.StandardCurve,
        showEndArrow: edge.kind !== 'contains',
        useTextOnPath: edge.kind !== 'contains',
        data: edge,
      }
    })

  return {
    rootId: selectedFilePath ? `file:${selectedFilePath}` : visibleNodes[0]?.id,
    nodes: graphNodes,
    lines: graphLines,
  }
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

function CodeGraphCanvas({ files, symbols, relations, codegraphDb, selectedFilePath, onSelectFile }: CodeGraphViewProps) {
  const graphInstance = RGHooks.useGraphInstance()
  const graphData = useMemo(
    () => codegraphDb
      ? buildCodegraphDbGraphData(codegraphDb, selectedFilePath)
      : buildGraphData(files, symbols, relations, selectedFilePath),
    [codegraphDb, files, relations, selectedFilePath, symbols],
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
    const dbFilePath = typeof node.data?.file_path === 'string' ? node.data.file_path : null
    const symbolFilePath = typeof node.data?.filePath === 'string' ? node.data.filePath : null
    if (dbFilePath) {
      onSelectFile(dbFilePath)
      return true
    }
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
