'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { AlertCircle, ExternalLink, Gitlab, Loader2, RefreshCw, Route, Terminal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type {
  ReviewWorkflowNode,
  ReviewWorkflowSnapshot,
  WorkflowIssue,
} from './review-workflow-types'
import {
  compactWorkflowText,
  getWorkflowNodeMessage,
  reviewWorkflowKindLabels,
} from './review-workflow-types'

const WorkflowCanvas = dynamic(
  () => import('./review-workflow-canvas').then((mod) => mod.ReviewWorkflowCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-72 items-center justify-center rounded-lg border border-border/60 bg-muted/30 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载过程图...
      </div>
    ),
  },
)

type ReviewWorkflowTabProps = {
  reviewId: string
  reviewStatus: string
  issues: WorkflowIssue[]
  onOpenIssue: (issueId: string) => void
}

const terminalStatuses = new Set(['completed', 'failed', 'cancelled'])

const statusClassNames: Record<string, string> = {
  running: 'border-primary/30 bg-primary/10 text-primary',
  success: 'border-emerald-600/20 bg-emerald-500/10 text-emerald-800',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-800',
  failed: 'border-destructive/30 bg-destructive/5 text-destructive',
  cancelled: 'border-border bg-muted text-muted-foreground',
  skipped: 'border-border bg-muted/60 text-muted-foreground',
  idle: 'border-border bg-background text-muted-foreground',
}

const eventLevelClassNames: Record<string, string> = {
  running: 'border-primary/30 bg-primary/10 text-primary',
  success: 'border-emerald-600/20 bg-emerald-500/10 text-emerald-800',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-800',
  error: 'border-destructive/30 bg-destructive/5 text-destructive',
  muted: 'border-border bg-muted/50 text-muted-foreground',
}

const eventDotClassNames: Record<string, string> = {
  running: 'bg-primary shadow-[0_0_0_4px_rgba(204,120,92,0.14)]',
  success: 'bg-emerald-600',
  warning: 'bg-amber-500',
  error: 'bg-destructive',
  muted: 'bg-muted-foreground',
}

const statusLabels: Record<string, string> = {
  running: '运行中',
  success: '成功',
  warning: '警告',
  failed: '失败',
  cancelled: '已取消',
  skipped: '跳过',
  idle: '等待',
}

function getRuntimeRoleLabel(node: ReviewWorkflowNode | null) {
  if (!node) return '主链路'
  if (node.nodeKey.startsWith('pi:')) return 'Pi Runtime'
  return '主链路'
}

function formatJson(value: unknown) {
  if (!value) return '无'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatTime(value: string | null | undefined) {
  if (!value) return '--:--:--'
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatDuration(durationMs: number | null) {
  if (!durationMs) return '未完成'
  if (durationMs < 1000) return `${durationMs}ms`
  const seconds = Math.round(durationMs / 100) / 10
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

function getEventLevel(status: string): keyof typeof eventLevelClassNames {
  if (status === 'running') return 'running'
  if (status === 'success') return 'success'
  if (status === 'warning') return 'warning'
  if (status === 'failed') return 'error'
  return 'muted'
}

function getStatusLabel(status: string) {
  return statusLabels[status] || status
}

function nodeTimestamp(node: ReviewWorkflowNode) {
  return node.completedAt || node.startedAt || node.updatedAt || node.createdAt
}

function nodeConsoleMessage(node: ReviewWorkflowNode) {
  return compactWorkflowText(getWorkflowNodeMessage(node), 180)
}

function isStreamingReviewNode(node: ReviewWorkflowNode) {
  return node.kind === 'iteration_stage' && node.nodeKey.includes(':review') && node.status === 'running'
}

function issueMatchesNode(issue: WorkflowIssue, node: ReviewWorkflowNode | null) {
  if (!node) return false
  if (!node.piReviewRunId) return node.kind === 'aggregate' || node.kind === 'publish' || node.kind === 'finish'
  return issue.piReviewRunId === node.piReviewRunId
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown) {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function metricValue(metrics: Record<string, unknown> | null, key: string) {
  return stringValue(metrics?.[key])
}

function rawValue(node: ReviewWorkflowNode, key: string) {
  return stringValue(asRecord(node.rawJson)?.[key])
}

function getDefaultSelectedNodeKey(nodes: ReviewWorkflowNode[]) {
  const streamingReviewNode = nodes.find(isStreamingReviewNode)
  if (streamingReviewNode) return streamingReviewNode.nodeKey

  const reversedNodes = [...nodes].reverse()
  return (
    reversedNodes.find((node) => node.kind === 'iteration_stage' && node.nodeKey.includes(':review'))?.nodeKey ||
    reversedNodes.find((node) => node.kind === 'iteration_stage')?.nodeKey ||
    nodes.at(-1)?.nodeKey ||
    null
  )
}

function getWorkflowStageLabel(node: ReviewWorkflowNode) {
  if (node.nodeKey.startsWith('pi:')) return 'Pi Review'
  return reviewWorkflowKindLabels[node.kind] || node.kind
}

function getWorkflowIterationLabel(node: ReviewWorkflowNode) {
  if (!node.nodeKey.startsWith('pi:')) return getRuntimeRoleLabel(node)
  return getRuntimeRoleLabel(node)
}

function getNodeInputFacts(node: ReviewWorkflowNode) {
  const metrics = asRecord(node.metricsJson)
  const facts: Array<{ label: string; value: string }> = []
  const pushFact = (label: string, value: string) => {
    if (value) facts.push({ label, value })
  }

  pushFact('标题', metricValue(metrics, 'inputTitle'))

  const changedFiles = metricValue(metrics, 'inputChangedFiles')
  const diffCount = metricValue(metrics, 'inputDiffs')
  if (changedFiles || diffCount) {
    pushFact('变更范围', `文件 ${changedFiles || '0'} · Diff ${diffCount || '0'}`)
  }

  const existingFindings = metricValue(metrics, 'inputExistingFindings') || metricValue(metrics, 'currentFindings')
  const remainingBudget = metricValue(metrics, 'remainingFindingBudget')
  if (existingFindings || remainingBudget) {
    pushFact('Finding', `已有 ${existingFindings || '0'} · 剩余 ${remainingBudget || '0'}`)
  }

  const promptChars = metricValue(metrics, 'inputPromptChars')
  const contextChars = metricValue(metrics, 'inputContextSummaryChars')
  if (promptChars || contextChars) {
    pushFact('输入规模', `Prompt ${promptChars || '0'} 字符 · 上下文 ${contextChars || '0'} 字符`)
  }

  const selectedFiles = metricValue(metrics, 'selectedFiles')
  const fileContexts = metricValue(metrics, 'fileContexts')
  const graphNeighbors = metricValue(metrics, 'graphNeighbors')
  if (selectedFiles || fileContexts || graphNeighbors) {
    pushFact('上下文命中', `选择 ${selectedFiles || '0'} · 文件 ${fileContexts || '0'} · 关系 ${graphNeighbors || '0'}`)
  }

  const requestedFiles = metricValue(metrics, 'requestedFiles')
  const maxDepth = metricValue(metrics, 'maxDepth')
  if (requestedFiles || maxDepth) {
    pushFact('检索参数', `请求文件 ${requestedFiles || '0'} · 调用深度 ${maxDepth || '0'}`)
  }

  const requestedTools = metrics?.requestedTools
  if (Array.isArray(requestedTools)) {
    pushFact('工具请求', requestedTools.length > 0 ? requestedTools.map(String).join('、') : '无')
  }

  const inputChars = metricValue(metrics, 'inputChars')
  const outputChars = metricValue(metrics, 'outputChars') || metricValue(metrics, 'streamingChars')
  if (inputChars || outputChars) {
    pushFact('IO 字符', `输入 ${inputChars || '0'} · 输出 ${outputChars || '0'}`)
  }

  return facts
}

function getNodeInputText(node: ReviewWorkflowNode) {
  const workflowInput = rawValue(node, 'workflowInput')
  if (workflowInput) return workflowInput

  const metrics = asRecord(node.metricsJson)
  const inputPreview = metricValue(metrics, 'inputPreview')
  if (inputPreview) return inputPreview

  const raw = asRecord(node.rawJson)
  const rawDetail = metricValue(raw, 'detail')
  if (node.status === 'running' && rawDetail) return rawDetail

  return '该节点未记录独立输入。可展开“指标”和“原始节点”查看底层运行数据。'
}

function getNodeOutputText(node: ReviewWorkflowNode) {
  const workflowOutput = rawValue(node, 'workflowOutput')
  if (workflowOutput) return workflowOutput

  if (node.detail) return node.detail
  return getWorkflowNodeMessage(node) || '暂无输出。'
}

function getOutputLabel(node: ReviewWorkflowNode) {
  if (isStreamingReviewNode(node)) return '输出（生成中）'
  if (node.status === 'running') return '输出（进行中）'
  return '输出'
}

function WorkflowTextBlock({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div className={`min-w-0 rounded-lg border p-3 ${accent ? 'border-primary/20 bg-primary/5' : 'border-border/60 bg-background/70'}`}>
      <p className="text-xs font-medium text-foreground">{label}</p>
      <pre className="mt-2 max-h-[420px] overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground/85">
        {value}
      </pre>
    </div>
  )
}

function WorkflowFactList({
  facts,
}: {
  facts: Array<{ label: string; value: string }>
}) {
  if (facts.length === 0) return null

  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2 2xl:grid-cols-1">
      {facts.map((fact) => (
        <div key={`${fact.label}-${fact.value}`} className="min-w-0 rounded-lg border border-border/60 bg-background/70 px-3 py-2">
          <p className="text-[11px] text-muted-foreground">{fact.label}</p>
          <p className="mt-1 truncate text-xs font-medium text-foreground">{fact.value}</p>
        </div>
      ))}
    </div>
  )
}

function WorkflowMetric({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/70 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-mono text-xs text-foreground">{value}</p>
    </div>
  )
}

function WorkflowStepList({
  logs,
  selectedNodeKey,
  runningNode,
  updatedAt,
  eventRef,
  onSelectNode,
}: {
  logs: Array<{
    node: ReviewWorkflowNode
    level: keyof typeof eventLevelClassNames
    timestamp: string
    message: string
  }>
  selectedNodeKey: string | null
  runningNode: ReviewWorkflowNode | null
  updatedAt: string
  eventRef: RefObject<HTMLDivElement | null>
  onSelectNode: (nodeKey: string) => void
}) {
  return (
    <section className="rounded-xl border border-border/60 bg-card/80">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold text-foreground">Runtime 执行控制台</p>
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {runningNode ? `running: ${runningNode.title}` : `snapshot: ${formatTime(updatedAt)}`}
          </p>
        </div>
        <Badge className={runningNode ? statusClassNames.running : statusClassNames.success}>
          {runningNode ? '实时' : '完成'}
        </Badge>
      </div>

      <div ref={eventRef} className="max-h-[560px] overflow-y-auto p-2">
        <div className="space-y-1 font-mono">
          {logs.map(({ node, level, timestamp, message }, index) => {
            const selected = selectedNodeKey === node.nodeKey
            const duration = node.durationMs === null ? '' : formatDuration(node.durationMs)
            return (
              <button
                key={node.nodeKey}
                type="button"
                className={`grid w-full grid-cols-[56px_minmax(0,1fr)] gap-3 rounded-lg border px-3 py-2 text-left transition-[background-color,border-color,transform] active:scale-[0.99] ${
                  selected
                    ? 'border-primary/40 bg-primary/10'
                    : 'border-transparent hover:border-border/80 hover:bg-muted/35'
                }`}
                onClick={() => onSelectNode(node.nodeKey)}
              >
                <span className="text-[11px] text-muted-foreground">
                  {String(index + 1).padStart(2, '0')} {formatTime(timestamp)}
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={`h-2 w-2 rounded-full ${eventDotClassNames[level]}`} />
                    <span className={`rounded-full border px-1.5 py-0.5 text-[10px] leading-none ${eventLevelClassNames[level]}`}>
                      {getStatusLabel(node.status)}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{getWorkflowStageLabel(node)}</span>
                    {duration && <span className="text-[11px] text-muted-foreground">{duration}</span>}
                  </span>
                  <span className="mt-1 block truncate text-[13px] font-medium text-foreground">
                    $ {node.title}
                  </span>
                  <span className="mt-0.5 block line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {message}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function NodeInspector({
  node,
  relatedIssues,
  onOpenIssue,
  runningNodeKey,
}: {
  node: ReviewWorkflowNode | null
  relatedIssues: WorkflowIssue[]
  onOpenIssue: (issueId: string) => void
  runningNodeKey: string | null
}) {
  if (!node) {
    return (
      <div className="rounded-xl border border-border/60 bg-card/80 p-4 text-sm text-muted-foreground">
        选择一个流程节点查看执行位置、输入、输出和原始指标。
      </div>
    )
  }

  const nodeInputFacts = getNodeInputFacts(node)
  const isRunningNode = node.nodeKey === runningNodeKey

  return (
    <section className="rounded-xl border border-border/60 bg-card/90 p-4 shadow-[0_8px_18px_rgba(20,20,19,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {isRunningNode && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            <p className="text-sm font-semibold text-foreground">执行节点</p>
            <Badge className={statusClassNames[node.status] || statusClassNames.idle}>
              {isRunningNode ? '当前执行' : getStatusLabel(node.status)}
            </Badge>
          </div>
          <h3 className="mt-2 text-base font-semibold leading-6 text-card-foreground">{node.title}</h3>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {getWorkflowIterationLabel(node)} / {node.nodeKey}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{getWorkflowStageLabel(node)}</Badge>
          <Badge variant="secondary">{getRuntimeRoleLabel(node)}</Badge>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <WorkflowMetric label="开始" value={formatTime(node.startedAt)} />
        <WorkflowMetric label="完成" value={formatTime(node.completedAt)} />
        <WorkflowMetric label="耗时" value={formatDuration(node.durationMs)} />
      </div>

      <WorkflowFactList facts={nodeInputFacts} />

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        <WorkflowTextBlock label="输入" value={getNodeInputText(node)} />
        <WorkflowTextBlock label={getOutputLabel(node)} value={getNodeOutputText(node)} accent={isRunningNode} />
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">关联问题</p>
          <span className="font-mono text-xs text-muted-foreground">{relatedIssues.length}</span>
        </div>
        {relatedIssues.length > 0 ? (
          <div className="mt-2 divide-y divide-border/60 rounded-lg border border-border/60 bg-background/70">
            {relatedIssues.slice(0, 4).map((issue) => (
              <div key={issue.id} className="p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline">{issue.severity}</Badge>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="xs" onClick={() => onOpenIssue(issue.id)}>
                      <ExternalLink className="h-3 w-3" />
                      查看问题
                    </Button>
                    {issue.gitlabDiffUrl && (
                      <Button variant="ghost" size="xs" asChild>
                        <a href={issue.gitlabDiffUrl} target="_blank" rel="noreferrer">
                          <Gitlab className="h-3 w-3" />
                          打开行
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
                <p className="mt-2 truncate font-mono text-muted-foreground">
                  {issue.filePath}:{issue.lineNumber}
                </p>
                <p className="mt-1 line-clamp-2 leading-5 text-foreground/80">{issue.content}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 rounded-lg border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
            暂无关联问题。
          </p>
        )}
      </div>

      <div className="mt-4 grid gap-2 xl:grid-cols-2">
        <details className="rounded-lg border border-border/60 bg-background/70 p-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">指标</summary>
          <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
            {formatJson(node.metricsJson)}
          </pre>
        </details>

        <details className="rounded-lg border border-border/60 bg-background/70 p-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">原始节点</summary>
          <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
            {formatJson(node.rawJson || node)}
          </pre>
        </details>
      </div>
    </section>
  )
}

export function ReviewWorkflowTab({
  reviewId,
  reviewStatus,
  issues,
  onOpenIssue,
}: ReviewWorkflowTabProps) {
  const [workflow, setWorkflow] = useState<ReviewWorkflowSnapshot | null>(null)
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const eventRef = useRef<HTMLDivElement | null>(null)

  const loadWorkflow = useCallback((options: { silent?: boolean } = {}) => {
    if (!options.silent) setLoading(true)
    if (!options.silent) setError(null)
    return fetch(`/api/reviews/${reviewId}/workflow`)
      .then((response) => {
        if (!response.ok) {
          return response.json().catch(() => ({})).then((body) => {
            throw new Error(body.error || '加载过程图失败')
          })
        }
        return response.json()
      })
      .then((data: ReviewWorkflowSnapshot) => {
        setWorkflow(data)
        setSelectedNodeKey((current) => {
          if (current && data.nodes.some((node) => node.nodeKey === current)) return current
          return getDefaultSelectedNodeKey(data.nodes)
        })
      })
      .catch((err) => {
        console.error('Failed to load review workflow:', err)
        if (!options.silent) {
          setError(err instanceof Error ? err.message : '加载过程图失败')
        }
      })
      .finally(() => {
        if (!options.silent) setLoading(false)
      })
  }, [reviewId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadWorkflow()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadWorkflow])

  useEffect(() => {
    const status = workflow?.reviewStatus || reviewStatus
    if (terminalStatuses.has(status)) return

    const timer = window.setInterval(() => {
      loadWorkflow({ silent: true })
    }, 2000)

    return () => window.clearInterval(timer)
  }, [loadWorkflow, reviewStatus, workflow?.reviewStatus])

  const selectedNode = useMemo(() => {
    if (!workflow) return null
    return workflow.nodes.find((node) => node.nodeKey === selectedNodeKey) || workflow.nodes.at(-1) || null
  }, [selectedNodeKey, workflow])

  const relatedIssues = useMemo(() => {
    const matched = issues.filter((issue) => issueMatchesNode(issue, selectedNode))
    return matched.length > 0 ? matched : issues.slice(0, 8)
  }, [issues, selectedNode])

  const eventLogs = useMemo(() => {
    if (!workflow) return []
    return workflow.nodes
      .map((node) => ({
        node,
        level: getEventLevel(node.status),
        timestamp: nodeTimestamp(node),
        message: nodeConsoleMessage(node),
      }))
      .sort((left, right) => (
        new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime() ||
        left.node.sequence - right.node.sequence
      ))
  }, [workflow])

  const runningNode = useMemo(() => (
    workflow?.nodes.find((node) => node.status === 'running') || null
  ), [workflow])

  useEffect(() => {
    if (!eventRef.current) return
    eventRef.current.scrollTop = eventRef.current.scrollHeight
  }, [eventLogs.length, workflow?.updatedAt])

  if (loading && !workflow) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-border/60 bg-muted/30 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        正在加载动态过程图...
      </div>
    )
  }

  if (error && !workflow) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
        <div className="flex items-center gap-2 font-medium">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => loadWorkflow()}>
          <RefreshCw className="h-4 w-4" />
          重试
        </Button>
      </div>
    )
  }

  if (!workflow) return null

  return (
    <div className="grid gap-4 2xl:grid-cols-[minmax(360px,0.42fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-card/70 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={runningNode ? statusClassNames.running : statusClassNames.success}>
              {runningNode ? '运行中' : '最终快照'}
            </Badge>
            <Badge variant="outline">步骤 {workflow.nodes.length}</Badge>
            <Badge variant="outline">更新 {formatTime(workflow.updatedAt)}</Badge>
          </div>
          <Button variant="outline" size="sm" onClick={() => loadWorkflow()}>
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
        </div>

        <WorkflowStepList
          logs={eventLogs}
          selectedNodeKey={selectedNode?.nodeKey || null}
          runningNode={runningNode}
          updatedAt={workflow.updatedAt}
          eventRef={eventRef}
          onSelectNode={setSelectedNodeKey}
        />

        <section className="rounded-xl border border-border/60 bg-card/70 p-3">
          <div className="mb-3 flex items-center gap-2 px-1 text-sm font-semibold text-foreground">
            <Route className="h-4 w-4 text-primary" />
            流程拓扑
          </div>
          <WorkflowCanvas
            workflow={workflow}
            selectedNodeKey={selectedNode?.nodeKey || null}
            onSelectNode={(node) => setSelectedNodeKey(node.nodeKey)}
            compact
          />
        </section>
      </div>

      <div className="min-w-0">
        <NodeInspector
          node={selectedNode}
          relatedIssues={relatedIssues}
          onOpenIssue={onOpenIssue}
          runningNodeKey={runningNode?.nodeKey || null}
        />
      </div>
    </div>
  )
}
