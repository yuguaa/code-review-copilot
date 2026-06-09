'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ExternalLink, Gitlab, Loader2, RefreshCw, Terminal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type {
  ReviewWorkflowNode,
  ReviewWorkflowSnapshot,
  WorkflowIssue,
} from './review-workflow-types'
import { reviewWorkflowKindLabels } from './review-workflow-types'

const WorkflowCanvas = dynamic(
  () => import('./review-workflow-canvas').then((mod) => mod.ReviewWorkflowCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[620px] items-center justify-center rounded-lg border border-border/60 bg-muted/30 text-sm text-muted-foreground">
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

const consoleLevelClassNames: Record<string, string> = {
  running: 'border-amber-300/30 bg-amber-300/10 text-amber-100',
  success: 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100',
  warning: 'border-orange-300/30 bg-orange-300/10 text-orange-100',
  error: 'border-red-300/35 bg-red-300/10 text-red-100',
  muted: 'border-zinc-700 bg-zinc-900/70 text-zinc-300',
}

const consoleDotClassNames: Record<string, string> = {
  running: 'bg-amber-300 shadow-[0_0_0_4px_rgba(252,211,77,0.16)]',
  success: 'bg-emerald-300',
  warning: 'bg-orange-300',
  error: 'bg-red-300 shadow-[0_0_0_4px_rgba(252,165,165,0.18)]',
  muted: 'bg-zinc-500',
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

function getConsoleLevel(status: string) {
  if (status === 'running') return 'running'
  if (status === 'success') return 'success'
  if (status === 'warning') return 'warning'
  if (status === 'failed') return 'error'
  return 'muted'
}

function getConsoleStatusLabel(status: string) {
  switch (status) {
    case 'running':
      return 'RUNNING'
    case 'success':
      return 'SUCCESS'
    case 'warning':
      return 'WARN'
    case 'failed':
      return 'ERROR'
    case 'cancelled':
      return 'CANCELLED'
    case 'skipped':
      return 'SKIPPED'
    default:
      return status.toUpperCase()
  }
}

function nodeTimestamp(node: ReviewWorkflowNode) {
  return node.completedAt || node.startedAt || node.updatedAt || node.createdAt
}

function nodeConsoleMessage(node: ReviewWorkflowNode) {
  if (node.status === 'failed') {
    return node.detail || node.summary || '步骤执行失败'
  }
  if (node.status === 'running') {
    return node.detail || node.summary || '正在执行'
  }
  return node.summary || node.detail || '状态已更新'
}

function issueMatchesNode(issue: WorkflowIssue, node: ReviewWorkflowNode | null) {
  if (!node) return false
  if (!node.reviewBotRunId) return node.kind === 'aggregate' || node.kind === 'publish' || node.kind === 'finish'
  return issue.reviewBotRunId === node.reviewBotRunId
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
  const consoleRef = useRef<HTMLDivElement | null>(null)

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
          return data.nodes.at(-1)?.nodeKey || null
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

  const consoleLogs = useMemo(() => {
    if (!workflow) return []
    return workflow.nodes
      .map((node) => ({
        node,
        level: getConsoleLevel(node.status),
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
    if (!consoleRef.current) return
    consoleRef.current.scrollTop = consoleRef.current.scrollHeight
  }, [consoleLogs.length, workflow?.updatedAt])

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
    <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">节点 {workflow.nodes.length}</Badge>
            <Badge variant="outline">边 {workflow.edges.length}</Badge>
            <Badge className={statusClassNames[workflow.nodes.find((node) => node.status === 'running') ? 'running' : 'success']}>
              {workflow.nodes.find((node) => node.status === 'running') ? '动态更新中' : '当前快照'}
            </Badge>
          </div>
          <Button variant="outline" size="sm" onClick={() => loadWorkflow()}>
            <RefreshCw className="h-4 w-4" />
            刷新图
          </Button>
        </div>
        <WorkflowCanvas
          workflow={workflow}
          selectedNodeKey={selectedNode?.nodeKey || null}
          onSelectNode={(node) => setSelectedNodeKey(node.nodeKey)}
        />
      </div>

      <aside className="flex min-h-0 max-h-[720px] flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-[0_18px_45px_rgba(24,24,27,0.18)]">
        <div className="border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-zinc-400" />
                <p className="text-sm font-semibold text-zinc-100">实时控制台</p>
              </div>
              <p className="mt-1 truncate text-xs text-zinc-500">
                {runningNode ? `当前：${runningNode.title}` : `快照：${formatTime(workflow.updatedAt)}`}
              </p>
            </div>
            <Badge className={runningNode ? consoleLevelClassNames.running : consoleLevelClassNames.success}>
              {runningNode ? 'LIVE' : 'IDLE'}
            </Badge>
          </div>
        </div>

        <div ref={consoleRef} className="min-h-[340px] flex-1 space-y-2 overflow-y-auto px-3 py-3 font-mono text-xs">
          {consoleLogs.map(({ node, level, timestamp, message }) => {
            const selected = selectedNode?.nodeKey === node.nodeKey
            const duration = node.durationMs === null ? '' : formatDuration(node.durationMs)
            return (
              <button
                key={node.nodeKey}
                type="button"
                className={`block w-full rounded-lg border p-3 text-left transition-[background-color,border-color,transform] active:scale-[0.99] ${
                  selected
                    ? 'border-zinc-500 bg-zinc-900'
                    : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700 hover:bg-zinc-900/80'
                }`}
                onClick={() => setSelectedNodeKey(node.nodeKey)}
              >
                <div className="flex items-start gap-2">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${consoleDotClassNames[level]}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-zinc-500">{formatTime(timestamp)}</span>
                      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] leading-none ${consoleLevelClassNames[level]}`}>
                        {getConsoleStatusLabel(node.status)}
                      </span>
                      <span className="text-zinc-400">{reviewWorkflowKindLabels[node.kind] || node.kind}</span>
                      {duration && <span className="text-zinc-600">{duration}</span>}
                    </div>
                    <p className="mt-1 truncate text-[13px] font-semibold text-zinc-100">{node.title}</p>
                    <p className={`mt-1 whitespace-pre-wrap break-words leading-5 ${
                      node.status === 'failed' ? 'text-red-100' : 'text-zinc-400'
                    }`}>
                      {message}
                    </p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        <div className="border-t border-zinc-800 bg-zinc-950/95 p-4">
          {selectedNode ? (
            <div className="space-y-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={statusClassNames[selectedNode.status] || statusClassNames.idle}>
                    {selectedNode.status}
                  </Badge>
                  <Badge variant="outline" className="border-zinc-700 text-zinc-300">{selectedNode.kind}</Badge>
                </div>
                <h3 className="mt-2 text-base font-semibold text-zinc-100">{selectedNode.title}</h3>
                {selectedNode.summary && (
                  <p className="mt-1 text-sm leading-6 text-zinc-400">{selectedNode.summary}</p>
                )}
                {selectedNode.detail && (
                  <p className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-900 p-3 text-xs leading-5 text-zinc-300">
                    {selectedNode.detail}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 text-[11px] text-zinc-500">
                <p className="rounded-md bg-zinc-900 p-2">开始<br /><span className="text-zinc-300">{formatTime(selectedNode.startedAt)}</span></p>
                <p className="rounded-md bg-zinc-900 p-2">完成<br /><span className="text-zinc-300">{formatTime(selectedNode.completedAt)}</span></p>
                <p className="rounded-md bg-zinc-900 p-2">耗时<br /><span className="text-zinc-300">{formatDuration(selectedNode.durationMs)}</span></p>
              </div>

              <section>
                <p className="text-xs font-medium text-zinc-300">相关问题</p>
                {relatedIssues.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    {relatedIssues.slice(0, 4).map((issue) => (
                      <div key={issue.id} className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant="outline" className="border-zinc-700 text-zinc-300">{issue.severity}</Badge>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="xs" className="text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100" onClick={() => onOpenIssue(issue.id)}>
                              <ExternalLink className="h-3 w-3" />
                              查看
                            </Button>
                            {issue.gitlabDiffUrl && (
                              <Button variant="ghost" size="xs" className="text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100" asChild>
                                <a href={issue.gitlabDiffUrl} target="_blank" rel="noreferrer">
                                  <Gitlab className="h-3 w-3" />
                                  行
                                </a>
                              </Button>
                            )}
                          </div>
                        </div>
                        <p className="mt-1 truncate font-mono text-zinc-500">
                          {issue.filePath}:{issue.lineNumber}
                        </p>
                        <p className="mt-1 line-clamp-2 text-zinc-300">{issue.content}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 rounded-lg bg-zinc-900 p-3 text-xs text-zinc-500">暂无关联问题。</p>
                )}
              </section>

              <details className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
                <summary className="cursor-pointer text-sm font-medium text-zinc-200">指标</summary>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-zinc-400">
                  {formatJson(selectedNode.metricsJson)}
                </pre>
              </details>

              <details className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
                <summary className="cursor-pointer text-sm font-medium text-zinc-200">原始节点</summary>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-zinc-400">
                  {formatJson(selectedNode.rawJson || selectedNode)}
                </pre>
              </details>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">选择一个节点查看详情。</p>
          )}
        </div>
      </aside>
    </div>
  )
}
