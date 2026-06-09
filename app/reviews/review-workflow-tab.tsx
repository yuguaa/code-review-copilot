'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, ExternalLink, Gitlab, Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type {
  ReviewWorkflowNode,
  ReviewWorkflowSnapshot,
  WorkflowIssue,
} from './review-workflow-types'

const WorkflowCanvas = dynamic(
  () => import('./review-workflow-canvas').then((mod) => mod.ReviewWorkflowCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[520px] items-center justify-center rounded-lg border border-border/60 bg-muted/30 text-sm text-muted-foreground">
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

function formatJson(value: unknown) {
  if (!value) return '无'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatDuration(durationMs: number | null) {
  if (!durationMs) return '未完成'
  if (durationMs < 1000) return `${durationMs}ms`
  const seconds = Math.round(durationMs / 100) / 10
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
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
    <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
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

      <aside className="min-h-0 rounded-xl border border-border/60 bg-card/60 p-4">
        {selectedNode ? (
          <div className="space-y-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={statusClassNames[selectedNode.status] || statusClassNames.idle}>
                  {selectedNode.status}
                </Badge>
                <Badge variant="outline">{selectedNode.kind}</Badge>
              </div>
              <h3 className="mt-3 text-lg font-semibold text-foreground">{selectedNode.title}</h3>
              {selectedNode.summary && (
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{selectedNode.summary}</p>
              )}
              {selectedNode.detail && (
                <p className="mt-2 whitespace-pre-wrap rounded-lg bg-background/70 p-3 text-xs leading-5 text-muted-foreground">
                  {selectedNode.detail}
                </p>
              )}
            </div>

            <div className="grid gap-2 text-xs text-muted-foreground">
              <p>开始：{selectedNode.startedAt ? new Date(selectedNode.startedAt).toLocaleString('zh-CN') : '未记录'}</p>
              <p>完成：{selectedNode.completedAt ? new Date(selectedNode.completedAt).toLocaleString('zh-CN') : '未完成'}</p>
              <p>耗时：{formatDuration(selectedNode.durationMs)}</p>
            </div>

            <section>
              <p className="text-sm font-medium text-foreground">相关问题</p>
              {relatedIssues.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {relatedIssues.map((issue) => (
                    <div key={issue.id} className="rounded-lg border border-border/50 bg-background/70 p-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="outline">{issue.severity}</Badge>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="xs" onClick={() => onOpenIssue(issue.id)}>
                            <ExternalLink className="h-3 w-3" />
                            查看
                          </Button>
                          {issue.gitlabDiffUrl && (
                            <Button variant="ghost" size="xs" asChild>
                              <a href={issue.gitlabDiffUrl} target="_blank" rel="noreferrer">
                                <Gitlab className="h-3 w-3" />
                                行
                              </a>
                            </Button>
                          )}
                        </div>
                      </div>
                      <p className="mt-1 truncate font-mono text-muted-foreground">
                        {issue.filePath}:{issue.lineNumber}
                      </p>
                      <p className="mt-1 line-clamp-2 text-foreground/80">{issue.content}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">暂无关联问题。</p>
              )}
            </section>

            <details className="rounded-lg border border-border/50 bg-background/70 p-3">
              <summary className="cursor-pointer text-sm font-medium text-foreground">指标</summary>
              <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
                {formatJson(selectedNode.metricsJson)}
              </pre>
            </details>

            <details className="rounded-lg border border-border/50 bg-background/70 p-3">
              <summary className="cursor-pointer text-sm font-medium text-foreground">原始节点</summary>
              <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
                {formatJson(selectedNode.rawJson || selectedNode)}
              </pre>
            </details>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">选择一个节点查看详情。</p>
        )}
      </aside>
    </div>
  )
}
