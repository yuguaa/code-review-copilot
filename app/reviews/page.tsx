'use client'

import React, { useCallback, useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ReviewWorkflowTab } from './review-workflow-tab'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Clock,
  AlertCircle,
  CheckCircle,
  Brain,
  FileSearch,
  GitCommit,
  GitMerge,
  Gitlab,
  ListChecks,
  Loader2,
  RefreshCw,
  Copy,
  Check,
  ShieldCheck,
  Square,
  Wrench,
  X
} from 'lucide-react'

// 审查记录类型定义
interface Review {
  id: string
  repositoryId: string
  repositoryName: string
  repositoryPath: string
  gitlabUrl: string
  mergeRequestId: number
  mergeRequestIid: number
  sourceBranch: string
  targetBranch: string
  author: string          // 姓名
  authorUsername: string | null  // 工号
  title: string
  description: string | null
  commitSha: string
  commitShortId: string
  status: string
  error: string | null
  totalFiles: number
  reviewedFiles: number
  criticalIssues: number
  normalIssues: number
  suggestions: number
  aiSummary: string | null  // AI 变更总结
  aiResponse: string | null // AI 完整回复（JSON 格式）
  reviewPrompts: string | null // 发送给 AI 的完整 Prompt
  aiModelProvider: string | null // AI 模型提供商
  aiModelId: string | null // AI 模型 ID
  attemptNumber: number
  totalAttempts: number
  startedAt: string
  completedAt: string | null
  eventType: 'push' | 'merge_request'
  botRuns: Array<{
    id: string
    botName: string
    botDescription: string | null
    status: string
    error: string | null
    summary: string | null
    aiModelProvider: string
    aiModelId: string
    aiModelName: string
    promptSnapshot: string | null
    promptMode: string
    startedAt: string
    completedAt: string | null
    comments: Array<{
      id: string
      filePath: string
      lineNumber: number
      lineRangeEnd?: number | null
      severity: string
      content: string
      confidence: number | null
    }>
    trace: {
      id: string
      loopIterationsJson: unknown
      finalPlanJson: unknown
      criticJson: unknown
      memoryUpdatesJson: unknown
      createdAt: string
      updatedAt: string
    } | null
  }>
  comments: Array<{
    id: string
    reviewBotRunId?: string | null
    filePath: string
    lineNumber: number
    lineRangeEnd?: number | null
    severity: string
    content: string
    confidence?: number | null
    sourceBotName?: string | null
    sourceBotModel?: string | null
    sourceBotsJson?: unknown
    isPosted: boolean
    gitlabDiffUrl?: string | null
  }>
}

interface ReviewGroup {
  id: string
  repositoryId: string
  mergeRequestIid: number
  commitSha: string
  totalAttempts: number
  latestStartedAt: string | null
  latestReview: Review | null
  attempts: Review[]
}

const findReviewById = (groups: ReviewGroup[], reviewId: string) => {
  for (const group of groups) {
    const matched = group.attempts.find((review) => review.id === reviewId)
    if (matched) return matched
  }
  return null
}

const findReviewGroup = (groups: ReviewGroup[], groupId: string) => (
  groups.find((group) => group.id === groupId) || null
)

const mergeReviewSummaryIntoDetail = (detail: Review, summary: Review): Review => ({
  ...detail,
  ...summary,
  aiSummary: detail.aiSummary,
  aiResponse: detail.aiResponse,
  reviewPrompts: detail.reviewPrompts,
  botRuns: detail.botRuns,
  comments: detail.comments,
})

const agentLoopStopReasonLabels: Record<string, string> = {
  continue: '继续',
  max_iterations: '达到最大轮次',
  max_findings: '达到问题上限',
  critic_stop: 'Critic 判定停止',
  no_new_findings: '无新增问题',
  no_more_context: '无更多上下文',
  no_requested_tools: '无工具请求',
  no_progress: '重复无进展',
}

const processStageClassNames = {
  done: 'border-emerald-600/20 bg-emerald-500/10 text-emerald-900',
  active: 'border-primary/30 bg-primary/10 text-primary',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-800',
  idle: 'border-border/50 bg-background/70 text-muted-foreground',
} as const

const processStageIconClassNames = {
  done: 'bg-emerald-600 text-white',
  active: 'bg-primary text-primary-foreground',
  warning: 'bg-amber-500 text-white',
  idle: 'bg-muted text-muted-foreground',
} as const

type ProcessStageStatus = keyof typeof processStageClassNames

interface ReviewProcessStage {
  key: string
  label: string
  status: ProcessStageStatus
  icon: React.ComponentType<{ className?: string }>
  summary: string
  detail: string
}

type AgentTraceEventStatus = 'running' | 'completed' | 'failed' | 'skipped'

interface AgentTraceEvent {
  id?: string
  at?: string
  iteration: number
  stage: string
  status: AgentTraceEventStatus
  title: string
  detail?: string
  durationMs?: number
  metrics?: Record<string, unknown>
}

export default function ReviewsPage() {
  const [reviewGroups, setReviewGroups] = useState<ReviewGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedReviewGroup, setSelectedReviewGroup] = useState<ReviewGroup | null>(null)
  const [selectedReview, setSelectedReview] = useState<Review | null>(null)
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null)
  const [loadingReviewId, setLoadingReviewId] = useState<string | null>(null)
  const [retryingReviewId, setRetryingReviewId] = useState<string | null>(null)
  const [stoppingReviewId, setStoppingReviewId] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  // 分页状态
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 20

  // 获取审查记录
  const fetchReviews = useCallback((page = 1, options: { silent?: boolean } = {}) => {
    if (!options.silent) {
      setLoading(true)
    }
    if (!options.silent) {
      setError(null)
    }
    return fetch(`/api/reviews?page=${page}&limit=${pageSize}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error('Failed to fetch reviews')
        }
        return response.json()
      })
      .then((data) => {
        const nextGroups = data.reviewGroups || []
        setReviewGroups(nextGroups)
        setSelectedReview((current) => {
          if (!current) return current
          const matchedSummary = findReviewById(nextGroups, current.id)
          return matchedSummary ? mergeReviewSummaryIntoDetail(current, matchedSummary) : current
        })
        setSelectedReviewGroup((current) => {
          if (!current) return current
          return findReviewGroup(nextGroups, current.id) || current
        })
        // 更新分页信息
        if (data.pagination) {
          setCurrentPage(data.pagination.page)
          setTotalPages(data.pagination.totalPages)
          setTotal(data.pagination.total)
        }
      })
      .catch((err) => {
        console.error('Failed to fetch reviews:', err)
        if (!options.silent) {
          setError('加载审查记录失败')
        }
      })
      .finally(() => {
        if (!options.silent) {
          setLoading(false)
        }
      })
  }, [])

  // 重新触发审查
  const retryReview = async (reviewId: string, event: React.MouseEvent) => {
    event.stopPropagation() // 阻止事件冒泡，避免触发行点击
    
    if (retryingReviewId) {
      return // 如果已有审查正在进行，不允许重复触发
    }
    
    try {
      setRetryingReviewId(reviewId)
      const response = await fetch(`/api/review/${reviewId}/retry`, {
        method: 'POST',
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to retry review')
      }

      await response.json()
      
      // 刷新审查记录列表
      await fetchReviews(1)
      
      setSelectedReview((current) => current?.id === reviewId ? null : current)
      setSelectedReviewGroup(null)
    } catch (err) {
      console.error('Failed to retry review:', err)
      alert(err instanceof Error ? err.message : '重新审查失败，请稍后重试')
    } finally {
      setRetryingReviewId(null)
    }
  }

  // 手动停止进行中的审查
  const stopReview = async (reviewId: string, event: React.MouseEvent) => {
    event.stopPropagation()

    if (stoppingReviewId) {
      return
    }

    try {
      setStoppingReviewId(reviewId)
      const response = await fetch(`/api/review/${reviewId}/stop`, {
        method: 'POST',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to stop review')
      }

      await fetchReviews(currentPage)

      if (selectedReview?.id === reviewId) {
        setSelectedReview((current) => current ? {
          ...current,
          status: 'cancelled',
          error: '手动停止',
          completedAt: new Date().toISOString(),
        } : current)
      }
    } catch (err) {
      console.error('Failed to stop review:', err)
      alert(err instanceof Error ? err.message : '停止审查失败，请稍后重试')
    } finally {
      setStoppingReviewId(null)
    }
  }

  const openReviewGroup = (group: ReviewGroup) => {
    setSelectedReviewGroup(group)
  }

  const openReviewDialog = (review: Review) => {
    setLoadingReviewId(review.id)
    return fetch(`/api/reviews/${review.id}`)
      .then((response) => {
        if (!response.ok) {
          return response.json().catch(() => ({})).then((body) => {
            throw new Error(body.error || '加载审查详情失败')
          })
        }
        return response.json()
      })
      .then((data) => {
        setSelectedReview(data.review || review)
      })
      .catch((err) => {
        console.error('Failed to load review detail:', err)
        alert(err instanceof Error ? err.message : '加载审查详情失败')
        setSelectedReview(review)
      })
      .finally(() => {
        setLoadingReviewId(null)
      })
  }

  // 解析 AI 回复 JSON
  const parseAiResponse = (aiResponse: string | null): Record<string, string> => {
    if (!aiResponse) return {}
    try {
      return JSON.parse(aiResponse)
    } catch {
      return {}
    }
  }

  const getGitlabLink = (review: Review) => {
    const base = review.gitlabUrl?.replace(/\/+$/, '')
    if (!base || !review.repositoryPath) return null
    if (review.eventType === 'merge_request' && review.mergeRequestIid) {
      return `${base}/${review.repositoryPath}/-/merge_requests/${review.mergeRequestIid}/diffs`
    }
    if (review.eventType === 'push' && review.commitSha) {
      return `${base}/${review.repositoryPath}/-/commit/${review.commitSha}`
    }
    return `${base}/${review.repositoryPath}`
  }

  const getGitlabFileLink = (
    review: Review,
    filePath: string,
    lineNumber: number,
    lineRangeEnd?: number | null
  ) => {
    const base = review.gitlabUrl?.replace(/\/+$/, '')
    if (!base || !review.repositoryPath || !filePath || !lineNumber) return null
    const ref = review.commitSha || review.sourceBranch
    // Encode each segment but keep `/`
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/')
    const hash =
      lineRangeEnd && lineRangeEnd !== lineNumber
        ? `#L${lineNumber}-${lineRangeEnd}`
        : `#L${lineNumber}`
    return `${base}/${review.repositoryPath}/-/blob/${ref}/${encodedPath}${hash}`
  }

  // 获取严重级别样式
  const getSeverityStyle = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'border-l-destructive bg-destructive/5'
      case 'normal':
        return 'border-l-amber-500 bg-amber-500/5'
      case 'suggestion':
        return 'border-l-blue-500 bg-blue-500/5'
      default:
        return 'border-l-muted-foreground bg-muted/5'
    }
  }

  // 获取严重级别图标
  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return '🔴'
      case 'normal':
        return '⚠️'
      case 'suggestion':
        return '💡'
      default:
        return '💬'
    }
  }

  // 格式化时间差
  const formatDuration = (started: string, completed: string | null) => {
    if (!completed) return null
    const start = new Date(started).getTime()
    const end = new Date(completed).getTime()
    const diff = Math.floor((end - start) / 1000)

    if (diff < 60) return `${diff}秒`
    if (diff < 3600) return `${Math.floor(diff / 60)}分钟`
    return `${Math.floor(diff / 3600)}小时${Math.floor((diff % 3600) / 60)}分钟`
  }

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      window.setTimeout(() => setCopiedKey(null), 1500)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const formatJson = (value: unknown) => {
    if (!value) return '无'
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }

  const extractLastReviewResponse = (botRun: Review['botRuns'][number]) => {
    const iterations = Array.isArray(botRun.trace?.loopIterationsJson)
      ? botRun.trace?.loopIterationsJson as Array<Record<string, unknown>>
      : []
    const last = [...iterations].reverse().find((item) => {
      const review = item.review as { response?: unknown } | undefined
      return typeof review?.response === 'string' && review.response.trim()
    })
    const review = last?.review as { response?: string } | undefined
    return review?.response || ''
  }

  const issueCount = (review: Review) => review.criticalIssues + review.normalIssues + review.suggestions

  const getReviewVerdict = (review: Review) => {
    if (review.status === 'failed') return '审查失败'
    if (review.status === 'cancelled') return '审查已停止'
    if (review.status === 'pending') return '审查进行中'
    if (review.criticalIssues > 0) return '高风险：存在严重问题'
    if (review.normalIssues > 0) return '中风险：需要关注一般问题'
    if (review.suggestions > 0) return '低风险：仅有优化建议'
    return 'LGTM：未发现可定位问题'
  }

  const getSeverityLabel = (severity: string) => {
    switch (severity) {
      case 'critical':
        return '严重'
      case 'normal':
        return '一般'
      case 'suggestion':
        return '建议'
      default:
        return severity || '未知'
    }
  }

  const getSeverityPillClass = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'border-destructive/30 bg-destructive/10 text-destructive'
      case 'normal':
        return 'border-amber-500/30 bg-amber-500/10 text-amber-700'
      case 'suggestion':
        return 'border-blue-500/30 bg-blue-500/10 text-blue-700'
      default:
        return 'border-border bg-muted text-muted-foreground'
    }
  }

  const getBotIterations = (botRun: Review['botRuns'][number]) => {
    return Array.isArray(botRun.trace?.loopIterationsJson)
      ? botRun.trace?.loopIterationsJson as Array<Record<string, unknown>>
      : []
  }

  const getBotTraceEvents = (botRun: Review['botRuns'][number]) => {
    return getBotIterations(botRun)
      .flatMap((iteration, iterationIndex) => {
        const events = Array.isArray(iteration.events) ? iteration.events : []
        return events
          .filter((event): event is Record<string, unknown> => Boolean(event && typeof event === 'object'))
          .map((event, eventIndex): AgentTraceEvent => ({
            id: typeof event.id === 'string' ? event.id : `${botRun.id}-${iterationIndex}-${eventIndex}`,
            at: typeof event.at === 'string' ? event.at : undefined,
            iteration: Number(event.iteration || iteration.iteration || iterationIndex + 1),
            stage: typeof event.stage === 'string' ? event.stage : 'unknown',
            status: event.status === 'running' || event.status === 'completed' || event.status === 'failed' || event.status === 'skipped'
              ? event.status
              : 'completed',
            title: typeof event.title === 'string' ? event.title : '未命名步骤',
            detail: typeof event.detail === 'string' ? event.detail : undefined,
            durationMs: typeof event.durationMs === 'number' ? event.durationMs : undefined,
            metrics: event.metrics && typeof event.metrics === 'object' && !Array.isArray(event.metrics)
              ? event.metrics as Record<string, unknown>
              : undefined,
          }))
      })
      .sort((left, right) => {
        if (!left.at || !right.at) return 0
        return new Date(left.at).getTime() - new Date(right.at).getTime()
      })
  }

  const getCurrentTraceEvent = (botRun: Review['botRuns'][number]) => {
    const events = getBotTraceEvents(botRun)
    return events.at(-1) || null
  }

  const formatTraceEventTime = (event: AgentTraceEvent) => {
    if (!event.at) return '时间未知'
    return new Date(event.at).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const formatTraceEventDuration = (durationMs?: number) => {
    if (!durationMs || durationMs < 0) return ''
    if (durationMs < 1000) return `${durationMs}ms`
    const seconds = Math.round(durationMs / 100) / 10
    if (seconds < 60) return `${seconds}s`
    return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
  }

  const getTraceEventStatusClass = (status: AgentTraceEventStatus) => {
    switch (status) {
      case 'running':
        return 'border-primary/30 bg-primary/10 text-primary'
      case 'completed':
        return 'border-emerald-600/20 bg-emerald-500/10 text-emerald-800'
      case 'failed':
        return 'border-destructive/30 bg-destructive/5 text-destructive'
      case 'skipped':
        return 'border-amber-500/30 bg-amber-500/10 text-amber-800'
      default:
        return 'border-border bg-muted text-muted-foreground'
    }
  }

  const getTraceEventStatusLabel = (status: AgentTraceEventStatus) => {
    switch (status) {
      case 'running':
        return '进行中'
      case 'completed':
        return '完成'
      case 'failed':
        return '失败'
      case 'skipped':
        return '跳过'
      default:
        return status
    }
  }

  const getTraceEventStageLabel = (stage: string) => {
    const labels: Record<string, string> = {
      initializing: '初始化',
      context: '上下文',
      plan: '计划',
      tool: '工具',
      review: '审查',
      validation: '校验',
      critic: '决策',
      finish: '完成',
      error: '异常',
    }
    return labels[stage] || stage
  }

  const formatReviewAttempt = (review: Pick<Review, 'attemptNumber' | 'totalAttempts'>) => {
    if (review.totalAttempts <= 1) return '首次审查'
    return `第 ${review.attemptNumber} / ${review.totalAttempts} 次`
  }

  const getIterationProgress = (iteration: Record<string, unknown>) => {
    const progress = iteration.progress && typeof iteration.progress === 'object'
      ? iteration.progress as { stopReason?: unknown; repeatedCount?: unknown }
      : null
    return {
      stopReason: typeof progress?.stopReason === 'string' ? progress.stopReason : null,
      repeatedCount: Number(progress?.repeatedCount || 0),
    }
  }

  const getIterationReviewMetrics = (iteration: Record<string, unknown>) => {
    return iteration.review && typeof iteration.review === 'object'
      ? iteration.review as {
          rawFindings?: unknown
          acceptedFindings?: unknown
          rejectedFindings?: unknown
          newFindings?: unknown
          totalFindings?: unknown
          rejectionCounts?: unknown
        }
      : null
  }

  const getIterationContextMetrics = (iteration: Record<string, unknown>) => {
    return iteration.contextMetrics && typeof iteration.contextMetrics === 'object'
      ? iteration.contextMetrics as {
          requestedFilesCount?: unknown
          selectedFilesCount?: unknown
          fileContextCount?: unknown
          graphNeighborCount?: unknown
          relatedReviewCount?: unknown
          missingSelectedFiles?: unknown
        }
      : null
  }

  const getIterationTools = (iteration: Record<string, unknown>) => {
    return Array.isArray(iteration.toolCalls)
      ? iteration.toolCalls as Array<{ tool?: unknown; status?: unknown; resultCount?: unknown }>
      : []
  }

  const getIterationPlan = (iteration: Record<string, unknown>) => {
    return iteration.plan && typeof iteration.plan === 'object'
      ? iteration.plan as { needsMoreContext?: unknown; contextFiles?: unknown; requestedTools?: unknown }
      : null
  }

  const getIterationToolSummary = (iteration: Record<string, unknown>) => {
    const tools = getIterationTools(iteration)
    if (tools.length === 0) return '无工具调用'
    return tools
      .map((tool) => `${String(tool.tool || 'unknown')}(${String(tool.status || 'unknown')}, ${String(tool.resultCount ?? 0)})`)
      .join('、')
  }

  const getIterationDecisionSummary = (iteration: Record<string, unknown>) => {
    const progress = getIterationProgress(iteration)
    if (!progress.stopReason) return '决策：旧 Trace 未记录'

    return `决策：${agentLoopStopReasonLabels[progress.stopReason] || progress.stopReason}${progress.repeatedCount > 1 ? `，重复 ${progress.repeatedCount} 次` : ''}`
  }

  const getIterationFindingRejectionParts = (iteration: Record<string, unknown>) => {
    const review = getIterationReviewMetrics(iteration)
    const counts = review?.rejectionCounts && typeof review.rejectionCounts === 'object'
      ? review.rejectionCounts as Record<string, unknown>
      : {}
    return [
      Number(counts.low_confidence || 0) > 0 ? `低置信 ${Number(counts.low_confidence)}` : '',
      Number(counts.file_not_in_diff || 0) > 0 ? `非 Diff 文件 ${Number(counts.file_not_in_diff)}` : '',
      Number(counts.invalid_line_range || 0) > 0 ? `无效行号 ${Number(counts.invalid_line_range)}` : '',
    ].filter(Boolean)
  }

  const getIterationFindingSummary = (iteration: Record<string, unknown>) => {
    const review = getIterationReviewMetrics(iteration)
    if (!review) return 'Finding：旧 Trace 未记录'

    const rejectionParts = getIterationFindingRejectionParts(iteration)
    const rejectedText = rejectionParts.length > 0 ? `（${rejectionParts.join('、')}）` : ''

    return [
      `Finding：原始 ${String(review.rawFindings ?? '未知')}`,
      `接受 ${String(review.acceptedFindings ?? '未知')}`,
      `丢弃 ${String(review.rejectedFindings ?? 0)}${rejectedText}`,
      `新增 ${String(review.newFindings ?? '未知')}`,
      `累计 ${String(review.totalFindings ?? '未知')}`,
    ].join(' · ')
  }

  const getIterationContextSummary = (iteration: Record<string, unknown>) => {
    const metrics = getIterationContextMetrics(iteration)
    if (!metrics) return '上下文：旧 Trace 未记录'

    const missingCount = Array.isArray(metrics.missingSelectedFiles) ? metrics.missingSelectedFiles.length : 0
    return [
      `上下文：请求 ${String(metrics.requestedFilesCount ?? 0)}`,
      `选择 ${String(metrics.selectedFilesCount ?? 0)}`,
      `文件命中 ${String(metrics.fileContextCount ?? 0)}`,
      `关系 ${String(metrics.graphNeighborCount ?? 0)}`,
      `历史 ${String(metrics.relatedReviewCount ?? 0)}`,
      `缺失 ${missingCount}`,
    ].join(' · ')
  }

  const buildReviewProcessStages = (iteration: Record<string, unknown>): ReviewProcessStage[] => {
    const plan = getIterationPlan(iteration)
    const tools = getIterationTools(iteration)
    const review = getIterationReviewMetrics(iteration)
    const metrics = getIterationContextMetrics(iteration)
    const progress = getIterationProgress(iteration)
    const requestedTools = Array.isArray(plan?.requestedTools) ? plan.requestedTools : []
    const contextFiles = Array.isArray(plan?.contextFiles) ? plan.contextFiles : []
    const toolResultCount = tools.reduce((total, tool) => total + Number(tool.resultCount || 0), 0)
    const unavailableToolCount = tools.filter((tool) => String(tool.status || '') === 'unavailable').length
    const missingCount = Array.isArray(metrics?.missingSelectedFiles) ? metrics.missingSelectedFiles.length : 0
    const rejectedCount = Number(review?.rejectedFindings || 0)
    const acceptedCount = Number(review?.acceptedFindings || 0)
    const stopReason = progress.stopReason
    const decisionStatus: ProcessStageStatus = stopReason === 'continue'
      ? 'active'
      : stopReason === 'no_progress' || stopReason === 'no_requested_tools' || stopReason === 'max_iterations'
        ? 'warning'
        : 'done'

    return [
      {
        key: 'plan',
        label: '计划',
        status: plan ? 'done' : 'idle',
        icon: Brain,
        summary: plan
          ? `${plan.needsMoreContext ? '需要更多上下文' : '上下文足够'} · 工具 ${requestedTools.length}`
          : '旧 Trace 未记录计划',
        detail: contextFiles.length > 0
          ? `目标文件：${contextFiles.slice(0, 3).map(String).join('、')}${contextFiles.length > 3 ? ` 等 ${contextFiles.length} 个` : ''}`
          : '没有追加目标文件',
      },
      {
        key: 'context',
        label: '上下文',
        status: metrics ? (missingCount > 0 ? 'warning' : 'done') : 'idle',
        icon: FileSearch,
        summary: metrics
          ? `文件 ${String(metrics.fileContextCount ?? 0)}/${String(metrics.selectedFilesCount ?? 0)} · 关系 ${String(metrics.graphNeighborCount ?? 0)}`
          : '旧 Trace 未记录上下文指标',
        detail: metrics
          ? `请求 ${String(metrics.requestedFilesCount ?? 0)} · 历史 ${String(metrics.relatedReviewCount ?? 0)} · 缺失 ${missingCount}`
          : '无法判断检索命中',
      },
      {
        key: 'tools',
        label: '工具',
        status: tools.length === 0 ? 'idle' : unavailableToolCount > 0 ? 'warning' : 'done',
        icon: Wrench,
        summary: tools.length > 0
          ? `${tools.length} 次调用 · 产出 ${toolResultCount}`
          : '无工具调用',
        detail: tools.length > 0
          ? tools.map((tool) => `${String(tool.tool || 'unknown')}=${String(tool.status || 'unknown')}`).join('、')
          : '本轮没有请求外部工具',
      },
      {
        key: 'findings',
        label: 'Finding',
        status: review ? (rejectedCount > 0 ? 'warning' : 'done') : 'idle',
        icon: ListChecks,
        summary: review
          ? `原始 ${String(review.rawFindings ?? 0)} · 接受 ${acceptedCount} · 丢弃 ${rejectedCount}`
          : '旧 Trace 未记录 Finding',
        detail: review
          ? `新增 ${String(review.newFindings ?? 0)} · 累计 ${String(review.totalFindings ?? 0)}${rejectedCount > 0 ? ` · ${getIterationFindingRejectionParts(iteration).join('、')}` : ''}`
          : '无法判断模型输出是否通过校验',
      },
      {
        key: 'critic',
        label: 'Critic',
        status: stopReason ? decisionStatus : 'idle',
        icon: ShieldCheck,
        summary: stopReason ? (agentLoopStopReasonLabels[stopReason] || stopReason) : '旧 Trace 未记录决策',
        detail: progress.repeatedCount > 1 ? `进展指纹重复 ${progress.repeatedCount} 次` : '已记录本轮停止/继续原因',
      },
    ]
  }

  const renderReviewProcessStage = (stage: ReviewProcessStage, index: number, isLast: boolean) => {
    const Icon = stage.icon
    return (
      <div key={stage.key} className="relative min-w-0">
        {!isLast && (
          <div className="absolute left-[1.125rem] top-9 hidden h-px w-[calc(100%_-_0.75rem)] bg-border/70 md:block" />
        )}
        <div className={`relative h-full rounded-lg border p-3 ${processStageClassNames[stage.status]}`}>
          <div className="flex items-center gap-2">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${processStageIconClassNames[stage.status]}`}>
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">0{index + 1} · {stage.label}</p>
              <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{stage.summary}</p>
            </div>
          </div>
          <p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">{stage.detail}</p>
        </div>
      </div>
    )
  }

  const renderTraceEvent = (event: AgentTraceEvent) => {
    const duration = formatTraceEventDuration(event.durationMs)
    return (
      <li key={event.id || `${event.iteration}-${event.stage}-${event.at}`} className="relative pl-7">
        <span className={`absolute left-0 top-1.5 flex h-4 w-4 items-center justify-center rounded-full border ${getTraceEventStatusClass(event.status)}`}>
          {event.status === 'running' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : event.status === 'failed' ? (
            <AlertCircle className="h-3 w-3" />
          ) : (
            <Check className="h-3 w-3" />
          )}
        </span>
        <div className="rounded-lg bg-background/70 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">第 {event.iteration} 轮</Badge>
            <Badge className={getTraceEventStatusClass(event.status)}>
              {getTraceEventStatusLabel(event.status)}
            </Badge>
            <span className="text-xs text-muted-foreground">{getTraceEventStageLabel(event.stage)}</span>
            <span className="text-xs font-mono text-muted-foreground">{formatTraceEventTime(event)}</span>
            {duration && <span className="text-xs font-mono text-muted-foreground">{duration}</span>}
          </div>
          <p className="mt-2 text-sm font-medium text-foreground">{event.title}</p>
          {event.detail && (
            <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{event.detail}</p>
          )}
          {event.metrics && Object.keys(event.metrics).length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted-foreground">查看指标</summary>
              <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-sidebar/50 p-2 text-[11px] text-muted-foreground whitespace-pre-wrap">
                {formatJson(event.metrics)}
              </pre>
            </details>
          )}
        </div>
      </li>
    )
  }

  const formatCommentSource = (comment: Review['comments'][number]) => {
    if (Array.isArray(comment.sourceBotsJson) && comment.sourceBotsJson.length > 0) {
      return comment.sourceBotsJson
        .map((source) => {
          if (!source || typeof source !== 'object') return '未知来源'
          const data = source as { botName?: string; model?: string; confidence?: number }
          return `${data.botName || '未知机器人'} / ${data.model || 'unknown'}`
        })
        .join('；')
    }

    return `${comment.sourceBotName || '默认审查机器人'} / ${comment.sourceBotModel || 'unknown'}`
  }

  const openIssueFromWorkflow = (issueId: string) => {
    setFocusedCommentId(issueId)
    window.setTimeout(() => {
      document.getElementById(`comment-${issueId}`)?.scrollIntoView({
        block: 'start',
        behavior: 'smooth',
      })
    }, 50)
    window.setTimeout(() => {
      setFocusedCommentId((current) => current === issueId ? null : current)
    }, 2800)
  }

  const getWorkflowIssues = (review: Review) => {
    return (review.comments || []).map((comment) => ({
      id: comment.id,
      reviewBotRunId: comment.reviewBotRunId,
      filePath: comment.filePath,
      lineNumber: comment.lineNumber,
      lineRangeEnd: comment.lineRangeEnd,
      severity: getSeverityLabel(comment.severity),
      content: comment.content,
      gitlabDiffUrl: comment.gitlabDiffUrl || getGitlabFileLink(review, comment.filePath, comment.lineNumber, comment.lineRangeEnd),
    }))
  }

  useEffect(() => {
    fetchReviews()
  }, [fetchReviews])

  useEffect(() => {
    const hasPendingReview = reviewGroups.some((group) => (
      group.latestReview?.status === 'pending' ||
      group.attempts.some((review) => review.status === 'pending')
    ))
    const shouldPoll = hasPendingReview || selectedReview?.status === 'pending'

    if (!shouldPoll) return

    const timer = window.setInterval(() => {
      fetchReviews(currentPage, { silent: true })
    }, 3000)

    return () => window.clearInterval(timer)
  }, [currentPage, fetchReviews, reviewGroups, selectedReview?.status])

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-sidebar-primary text-sidebar-primary-foreground border-0">已完成</Badge>
      case 'pending':
        return <Badge className="bg-sidebar text-sidebar-foreground border-border/40">进行中</Badge>
      case 'failed':
        return <Badge className="bg-destructive text-white border-0">失败</Badge>
      case 'cancelled':
        return <Badge className="bg-muted text-muted-foreground border-border/40">已停止</Badge>
      default:
        return <Badge className="bg-sidebar text-sidebar-foreground border-border/40">{status}</Badge>
    }
  }

  const selectedGitlabLink = selectedReview ? getGitlabLink(selectedReview) : null

  return (
    <div className="min-w-0 p-8">
      {/* 页面标题 */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground mb-1">
            审查历史
          </h1>
          <p className="text-sm text-muted-foreground">
            查看所有代码审查记录和结果
          </p>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => fetchReviews(currentPage)}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      {/* 审查历史列表 */}
      <Card className="min-w-0 overflow-hidden border-border/40">
        <div className="min-w-0 p-6">
          {loading ? (
            <div className="py-12 text-center text-muted-foreground">
              <RefreshCw className="h-8 w-8 mx-auto mb-4 animate-spin opacity-50" />
              <p>加载中...</p>
            </div>
          ) : error ? (
            <div className="py-12 text-center text-destructive">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{error}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => fetchReviews(1)}>
                重试
              </Button>
            </div>
          ) : reviewGroups.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>还没有审查记录</p>
              <p className="text-xs mt-2">配置仓库并添加分支配置后，审查记录将显示在这里</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-b-2">
                  <TableHead className="h-10 px-4 text-xs font-semibold text-muted-foreground">类型</TableHead>
                  <TableHead className="h-10 px-4 text-xs font-semibold text-muted-foreground">仓库</TableHead>
                  <TableHead className="h-10 px-4 text-xs font-semibold text-muted-foreground">信息</TableHead>
                  <TableHead className="h-10 px-4 text-xs font-semibold text-muted-foreground">作者</TableHead>
                  <TableHead className="h-10 px-4 text-xs font-semibold text-muted-foreground">分支</TableHead>
                  <TableHead className="h-10 px-4 text-xs font-semibold text-muted-foreground">状态</TableHead>
                  <TableHead className="h-10 px-4 text-xs font-semibold text-muted-foreground">问题</TableHead>
                  <TableHead className="h-10 px-4 text-xs font-semibold text-muted-foreground">时间</TableHead>
                  <TableHead className="h-10 px-4 text-xs font-semibold text-muted-foreground">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviewGroups.map((group: ReviewGroup) => {
                  const review = group.latestReview
                  if (!review) return null
                  return (
                  <TableRow 
                    key={group.id}
                    className="hover:bg-sidebar/50 cursor-pointer"
                    onClick={() => openReviewGroup(group)}
                  >
                    <TableCell className="px-4 py-3">
                      {review.eventType === 'push' ? (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <GitCommit className="h-4 w-4" />
                          <span className="text-xs">Push</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-sidebar-primary">
                          <GitMerge className="h-4 w-4" />
                          <span className="text-xs">MR</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <p className="text-sm font-medium text-foreground">{review.repositoryName}</p>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <p className="text-sm text-foreground truncate max-w-50">{review.title}</p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {review.eventType === 'push' 
                          ? review.commitShortId 
                          : `!${review.mergeRequestIid} · ${review.commitShortId}`}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        共 {group.totalAttempts} 次审查 · 最新 {formatReviewAttempt(review)}
                      </p>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="text-sm text-foreground">{review.author}</span>
                        {review.authorUsername && review.authorUsername !== review.author && (
                          <span className="text-xs text-muted-foreground">{review.authorUsername}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground">{review.sourceBranch}</span>
                        {review.targetBranch && (
                          <span className="text-xs text-muted-foreground">→ {review.targetBranch}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      {getStatusBadge(review.status)}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {review.status === 'completed' && review.criticalIssues === 0 && review.normalIssues === 0 && review.suggestions === 0 ? (
                          <div className="flex items-center gap-1 text-green-600">
                            <CheckCircle className="h-4 w-4" />
                            <span className="text-xs">LGTM</span>
                          </div>
                        ) : (
                          <>
                            {review.criticalIssues > 0 && (
                              <Badge className="bg-destructive/10 text-destructive border-destructive/20">
                                🔴 {review.criticalIssues}
                              </Badge>
                            )}
                            {review.normalIssues > 0 && (
                              <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                                ⚠️ {review.normalIssues}
                              </Badge>
                            )}
                            {review.suggestions > 0 && (
                              <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">
                                💡 {review.suggestions}
                              </Badge>
                            )}
                          </>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <span className="text-sm text-muted-foreground">
                        {new Date(review.startedAt).toLocaleString('zh-CN')}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      {review.status === 'pending' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => stopReview(review.id, e)}
                          disabled={stoppingReviewId === review.id}
                          className="h-8 text-xs text-destructive hover:text-destructive"
                        >
                          <Square className="h-3 w-3 mr-1" />
                          {stoppingReviewId === review.id ? '停止中' : '停止审查'}
                        </Button>
                      )}
                      {(review.status === 'failed' || review.status === 'completed' || review.status === 'cancelled') && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => retryReview(review.id, e)}
                          disabled={retryingReviewId === review.id}
                          className="h-8 text-xs"
                        >
                          <RefreshCw className={`h-3 w-3 mr-1 ${retryingReviewId === review.id ? 'animate-spin' : ''}`} />
                          {retryingReviewId === review.id ? '重审中' : '重新审查'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}

          {/* 分页控件 */}
          {!loading && !error && reviewGroups && reviewGroups.length > 0 && totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t mt-4">
              <div className="text-sm text-muted-foreground">
                共 {total} 条记录，第 {currentPage} / {totalPages} 页
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchReviews(currentPage - 1)}
                  disabled={currentPage <= 1 || loading}
                >
                  上一页
                </Button>
                <span className="text-sm text-muted-foreground px-2">
                  {currentPage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchReviews(currentPage + 1)}
                  disabled={currentPage >= totalPages || loading}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Dialog open={!!selectedReviewGroup} onOpenChange={() => setSelectedReviewGroup(null)}>
        <DialogContent className="w-[calc(100vw-3rem)] max-w-none sm:max-w-[1180px] max-h-[88vh] overflow-hidden">
          {selectedReviewGroup && selectedReviewGroup.latestReview && (
            <div className="flex max-h-[82vh] min-h-0 flex-col">
              <DialogHeader>
                <DialogTitle>审查记录列表</DialogTitle>
                <DialogDescription asChild>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">{selectedReviewGroup.latestReview.title}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      <span>仓库：{selectedReviewGroup.latestReview.repositoryName}</span>
                      <span>{selectedReviewGroup.latestReview.eventType === 'push' ? `Commit ${selectedReviewGroup.latestReview.commitShortId}` : `MR !${selectedReviewGroup.latestReview.mergeRequestIid} · Commit ${selectedReviewGroup.latestReview.commitShortId}`}</span>
                      <span>分支：{selectedReviewGroup.latestReview.sourceBranch}{selectedReviewGroup.latestReview.targetBranch ? ` → ${selectedReviewGroup.latestReview.targetBranch}` : ''}</span>
                      <span>共 {selectedReviewGroup.totalAttempts} 次审查</span>
                    </div>
                  </div>
                </DialogDescription>
              </DialogHeader>

              <div className="mt-4 min-h-0 overflow-y-auto">
                <div className="space-y-3">
                  {selectedReviewGroup.attempts.map((review) => (
                    <button
                      key={review.id}
                      type="button"
                      onClick={() => {
                        setSelectedReviewGroup(null)
                        openReviewDialog(review)
                      }}
                      className="w-full rounded-xl border border-border/60 bg-card/70 p-4 text-left transition hover:border-primary/40 hover:bg-primary/5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-foreground">{formatReviewAttempt(review)}</span>
                            {getStatusBadge(review.status)}
                            <Badge variant="outline">Log {review.id.slice(0, 8)}</Badge>
                            {loadingReviewId === review.id && (
                              <Badge variant="outline">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                加载详情
                              </Badge>
                            )}
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">
                            开始：{new Date(review.startedAt).toLocaleString('zh-CN')}
                            {review.completedAt ? ` · 用时：${formatDuration(review.startedAt, review.completedAt)}` : ''}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge className="bg-destructive/10 text-destructive border-destructive/20">严重 {review.criticalIssues}</Badge>
                          <Badge className="bg-amber-500/10 text-amber-700 border-amber-500/20">一般 {review.normalIssues}</Badge>
                          <Badge className="bg-blue-500/10 text-blue-700 border-blue-500/20">建议 {review.suggestions}</Badge>
                          <Badge variant="outline">文件 {review.reviewedFiles}/{review.totalFiles}</Badge>
                        </div>
                      </div>
                      {review.error && (
                        <p className="mt-3 rounded-lg bg-destructive/5 p-2 text-xs text-destructive">{review.error}</p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 审查详情弹窗 */}
      <Dialog open={!!selectedReview} onOpenChange={() => setSelectedReview(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-none sm:max-w-[1500px] max-h-[92vh] overflow-hidden p-0 border-border/60 shadow-2xl min-w-0" showCloseButton={false}>
          {selectedReview && (
            <div className="flex h-[90vh] min-w-0 flex-col bg-background">
              <DialogHeader className="border-b border-border/50 bg-[linear-gradient(135deg,var(--sidebar)_0%,var(--background)_55%,color-mix(in_srgb,var(--primary)_10%,var(--background))_100%)] px-6 py-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <DialogTitle className="text-2xl font-semibold tracking-tight">
                        {getReviewVerdict(selectedReview)}
                      </DialogTitle>
                      {getStatusBadge(selectedReview.status)}
                      {selectedGitlabLink && (
                        <Button variant="outline" size="sm" asChild>
                          <a href={selectedGitlabLink} target="_blank" rel="noreferrer">
                            <Gitlab className="h-4 w-4" />
                            GitLab
                          </a>
                        </Button>
                      )}
                    </div>
                    <DialogDescription asChild>
                      <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                        <p className="max-w-5xl truncate font-medium text-foreground">{selectedReview.title}</p>
                        <div className="flex flex-wrap gap-x-5 gap-y-1">
                          <span>仓库：{selectedReview.repositoryName}</span>
                          <span>作者：{selectedReview.author}{selectedReview.authorUsername ? `（${selectedReview.authorUsername}）` : ''}</span>
                          <span>{selectedReview.eventType === 'push' ? `Commit ${selectedReview.commitShortId}` : `MR !${selectedReview.mergeRequestIid} · Commit ${selectedReview.commitShortId}`}</span>
                          <span>{formatReviewAttempt(selectedReview)} · Log {selectedReview.id.slice(0, 8)}</span>
                          <span>分支：{selectedReview.sourceBranch}{selectedReview.targetBranch ? ` → ${selectedReview.targetBranch}` : ''}</span>
                        </div>
                      </div>
                    </DialogDescription>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                    {selectedReview.status === 'pending' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => stopReview(selectedReview.id, e)}
                        disabled={stoppingReviewId === selectedReview.id}
                        className="text-destructive hover:text-destructive"
                      >
                        <Square className="h-3 w-3" />
                        {stoppingReviewId === selectedReview.id ? '停止中...' : '停止审查'}
                      </Button>
                    )}
                    {(selectedReview.status === 'failed' || selectedReview.status === 'completed' || selectedReview.status === 'cancelled') && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => retryReview(selectedReview.id, e)}
                        disabled={retryingReviewId === selectedReview.id}
                      >
                        <RefreshCw className={`h-3 w-3 ${retryingReviewId === selectedReview.id ? 'animate-spin' : ''}`} />
                        {retryingReviewId === selectedReview.id ? '重审中...' : '重新审查'}
                      </Button>
                    )}
                    <DialogClose asChild>
                      <Button variant="ghost" size="icon-sm" aria-label="关闭审查详情弹窗">
                        <X className="h-4 w-4" />
                      </Button>
                    </DialogClose>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                    <p className="text-xs text-muted-foreground">问题总数</p>
                    <p className="mt-1 text-2xl font-semibold">{issueCount(selectedReview)}</p>
                  </div>
                  <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3">
                    <p className="text-xs text-muted-foreground">严重</p>
                    <p className="mt-1 text-2xl font-semibold text-destructive">{selectedReview.criticalIssues}</p>
                  </div>
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                    <p className="text-xs text-muted-foreground">一般</p>
                    <p className="mt-1 text-2xl font-semibold text-amber-700">{selectedReview.normalIssues}</p>
                  </div>
                  <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3">
                    <p className="text-xs text-muted-foreground">建议</p>
                    <p className="mt-1 text-2xl font-semibold text-blue-700">{selectedReview.suggestions}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                    <p className="text-xs text-muted-foreground">用时 / 文件</p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      {formatDuration(selectedReview.startedAt, selectedReview.completedAt) || '进行中'} · {selectedReview.reviewedFiles}/{selectedReview.totalFiles}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{new Date(selectedReview.startedAt).toLocaleString('zh-CN')}</p>
                  </div>
                </div>
              </DialogHeader>

              <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[360px_minmax(0,1fr)]">
                <aside className="min-h-0 overflow-y-auto border-b border-border/50 bg-sidebar/25 p-4 lg:border-b-0 lg:border-r">
                  <div className="space-y-4">
                    <section className="rounded-xl border border-border/60 bg-background/80 p-4">
                      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Review Index</p>
                      <div className="mt-3 space-y-2 text-sm">
                        <a href="#review-workflow" className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-sidebar">
                          <span>过程图</span>
                          <Badge variant="outline">Flow</Badge>
                        </a>
                        <a href="#review-issues" className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-sidebar">
                          <span>问题详情</span>
                          <Badge variant="outline">{selectedReview.comments?.length || 0}</Badge>
                        </a>
                        <a href="#review-summary" className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-sidebar">
                          <span>技术走查</span>
                          <Badge variant="outline">{selectedReview.aiSummary ? '有' : '无'}</Badge>
                        </a>
                        <a href="#review-agents" className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-sidebar">
                          <span>Agent Loop</span>
                          <Badge variant="outline">{selectedReview.botRuns?.length || 0}</Badge>
                        </a>
                        <a href="#review-raw" className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-sidebar">
                          <span>原始材料</span>
                          <Badge variant="outline">Trace</Badge>
                        </a>
                      </div>
                    </section>

                    <section className="rounded-xl border border-border/60 bg-background/80 p-4">
                      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">问题索引</p>
                      {selectedReview.comments && selectedReview.comments.length > 0 ? (
                        <div className="mt-3 space-y-2">
                          {selectedReview.comments.map((comment, index) => (
                            <a
                              key={comment.id}
                              href={`#comment-${comment.id}`}
                              className="block rounded-lg border border-border/50 bg-card/60 p-2 text-xs hover:border-primary/40 hover:bg-primary/5"
                            >
                              <div className="flex items-center gap-2">
                                <span>{getSeverityIcon(comment.severity)}</span>
                                <span className="font-medium text-foreground">#{index + 1} {getSeverityLabel(comment.severity)}</span>
                              </div>
                              <p className="mt-1 truncate font-mono text-muted-foreground">{comment.filePath}:{comment.lineNumber}</p>
                            </a>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 rounded-lg bg-muted p-3 text-sm text-muted-foreground">暂无可定位问题。</p>
                      )}
                    </section>

                    <section className="rounded-xl border border-border/60 bg-background/80 p-4">
                      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Agent 时间线</p>
                      <div className="mt-3 space-y-3">
                        {selectedReview.botRuns?.length ? selectedReview.botRuns.map((botRun) => {
                          const currentEvent = getCurrentTraceEvent(botRun)
                          const traceEvents = getBotTraceEvents(botRun)
                          return (
                            <div key={botRun.id} className="rounded-lg border border-border/50 bg-card/60 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-sm font-medium text-foreground">{botRun.botName}</p>
                                {getStatusBadge(botRun.status)}
                              </div>
                              <p className="mt-1 truncate text-xs text-muted-foreground">{botRun.aiModelName}</p>
                              {currentEvent ? (
                                <div className="mt-3 rounded-lg bg-background/70 p-2">
                                  <div className="flex items-center gap-2">
                                    {currentEvent.status === 'running' && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                                    <span className="text-xs font-medium text-foreground">{currentEvent.title}</span>
                                  </div>
                                  <p className="mt-1 truncate text-xs text-muted-foreground">
                                    第 {currentEvent.iteration} 轮 · {getTraceEventStageLabel(currentEvent.stage)} · {getTraceEventStatusLabel(currentEvent.status)}
                                  </p>
                                </div>
                              ) : (
                                <p className="mt-3 rounded-lg bg-muted p-2 text-xs text-muted-foreground">暂无实时步骤。</p>
                              )}
                              <div className="mt-2 flex flex-wrap gap-2">
                                <Badge variant="outline">问题 {botRun.comments.length}</Badge>
                                <Badge variant="outline">轮次 {getBotIterations(botRun).length}</Badge>
                                <Badge variant="outline">日志 {traceEvents.length}</Badge>
                              </div>
                            </div>
                          )
                        }) : (
                          <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">暂无 Agent 运行记录。</p>
                        )}
                      </div>
                    </section>
                  </div>
                </aside>

                <main className="min-h-0 overflow-y-auto p-5">
                  <div className="mx-auto max-w-6xl space-y-5">
                    <Tabs defaultValue="workflow" className="sticky top-0 z-10 rounded-xl border border-border/60 bg-background/95 p-2 shadow-sm backdrop-blur">
                      <TabsList variant="line" className="w-full justify-start overflow-x-auto">
                        <TabsTrigger value="workflow" asChild>
                          <a href="#review-workflow">过程图</a>
                        </TabsTrigger>
                        <TabsTrigger value="issues" asChild>
                          <a href="#review-issues">问题</a>
                        </TabsTrigger>
                        <TabsTrigger value="summary" asChild>
                          <a href="#review-summary">摘要</a>
                        </TabsTrigger>
                        <TabsTrigger value="agents" asChild>
                          <a href="#review-agents">Agent</a>
                        </TabsTrigger>
                        <TabsTrigger value="raw" asChild>
                          <a href="#review-raw">原始材料</a>
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>

                    <section id="review-workflow" className="scroll-mt-20 rounded-2xl border border-border/60 bg-background p-5">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Dynamic Workflow</p>
                          <h2 className="mt-1 text-xl font-semibold">审查过程图</h2>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline">2 秒轮询</Badge>
                          <Badge variant="outline">{selectedReview.status === 'pending' ? '运行中' : '最终快照'}</Badge>
                        </div>
                      </div>
                      <ReviewWorkflowTab
                        key={selectedReview.id}
                        reviewId={selectedReview.id}
                        reviewStatus={selectedReview.status}
                        issues={getWorkflowIssues(selectedReview)}
                        onOpenIssue={openIssueFromWorkflow}
                      />
                    </section>

                    <section id="review-issues" className="scroll-mt-4 rounded-2xl border border-border/60 bg-background p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">问题优先</p>
                          <h2 className="mt-1 text-xl font-semibold">全部问题清单</h2>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge className="bg-destructive/10 text-destructive border-destructive/20">严重 {selectedReview.criticalIssues}</Badge>
                          <Badge className="bg-amber-500/10 text-amber-700 border-amber-500/20">一般 {selectedReview.normalIssues}</Badge>
                          <Badge className="bg-blue-500/10 text-blue-700 border-blue-500/20">建议 {selectedReview.suggestions}</Badge>
                        </div>
                      </div>

                      {selectedReview.comments && selectedReview.comments.length > 0 ? (
                        <div className="mt-4 space-y-3">
                          {selectedReview.comments.map((comment, index) => {
                            const href = comment.gitlabDiffUrl || getGitlabFileLink(selectedReview, comment.filePath, comment.lineNumber, comment.lineRangeEnd)
                            return (
                              <article
                                id={`comment-${comment.id}`}
                                key={comment.id}
                                className={`scroll-mt-20 rounded-xl border p-4 transition-shadow ${getSeverityStyle(comment.severity)} ${
                                  focusedCommentId === comment.id
                                    ? 'border-primary shadow-[0_0_0_3px_rgba(204,120,92,0.22)]'
                                    : 'border-border/60'
                                }`}
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <Badge className={getSeverityPillClass(comment.severity)}>
                                        {getSeverityIcon(comment.severity)} #{index + 1} {getSeverityLabel(comment.severity)}
                                      </Badge>
                                      {comment.isPosted && (
                                        <Badge variant="outline">
                                          <CheckCircle className="h-3 w-3" />
                                          已发布 GitLab
                                        </Badge>
                                      )}
                                    </div>
                                    <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                                      {comment.filePath}:{comment.lineNumber}
                                      {comment.lineRangeEnd && comment.lineRangeEnd !== comment.lineNumber ? `-${comment.lineRangeEnd}` : ''}
                                    </p>
                                  </div>
                                  {href && (
                                    <Button variant="ghost" size="xs" asChild>
                                      <a href={href} target="_blank" rel="noreferrer">
                                        <Gitlab className="h-3 w-3" />
                                        打开行
                                      </a>
                                    </Button>
                                  )}
                                </div>
                                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">{comment.content}</p>
                                <p className="mt-3 text-xs text-muted-foreground">来源：{formatCommentSource(comment)}</p>
                              </article>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="mt-4 rounded-xl border border-emerald-600/20 bg-emerald-500/10 p-5 text-sm text-emerald-800">
                          未发现可定位、可行动的问题。若统计不为 0，可在下方原始材料中查看模型返回内容。
                        </div>
                      )}
                    </section>

                    <section id="review-summary" className="scroll-mt-4 rounded-2xl border border-border/60 bg-background p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Walkthrough</p>
                          <h2 className="mt-1 text-xl font-semibold">变更摘要与技术走查</h2>
                        </div>
                        {selectedReview.aiSummary && (
                          <Button variant="ghost" size="xs" onClick={() => handleCopy(selectedReview.aiSummary || '', 'summary')}>
                            {copiedKey === 'summary' ? <><Check className="h-3 w-3" /> 已复制</> : <><Copy className="h-3 w-3" /> 复制</>}
                          </Button>
                        )}
                      </div>
                      <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-sidebar/40 p-4 text-sm leading-6 text-foreground/90">
                        {selectedReview.aiSummary || '暂无 AI 总结。'}
                      </pre>
                    </section>

                    <section id="review-agents" className="scroll-mt-4 rounded-2xl border border-border/60 bg-background p-5">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Agent Evidence</p>
                        <h2 className="mt-1 text-xl font-semibold">Agent Loop 追溯</h2>
                      </div>

                      {selectedReview.botRuns && selectedReview.botRuns.length > 0 ? (
                        <div className="mt-4 space-y-4">
                          {selectedReview.botRuns.map((botRun) => {
                            const rawReview = extractLastReviewResponse(botRun)
                            const iterations = getBotIterations(botRun)
                            const traceEvents = getBotTraceEvents(botRun)
                            const currentEvent = getCurrentTraceEvent(botRun)
                            return (
                              <article key={botRun.id} className="rounded-xl border border-border/60 bg-card/60 p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h3 className="font-semibold text-foreground">{botRun.botName}</h3>
                                      {getStatusBadge(botRun.status)}
                                      <Badge variant="outline">{botRun.promptMode === 'replace' ? '替换 Prompt' : '扩展 Prompt'}</Badge>
                                    </div>
                                    <p className="mt-1 text-xs text-muted-foreground">{botRun.aiModelName}</p>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    <Badge variant="outline">问题 {botRun.comments.length}</Badge>
                                    <Badge variant="outline">Loop {iterations.length}</Badge>
                                    <Badge variant="outline">日志 {traceEvents.length}</Badge>
                                  </div>
                                </div>

                                {currentEvent && (
                                  <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                      {currentEvent.status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                                      <p className="text-sm font-semibold text-foreground">当前步骤：{currentEvent.title}</p>
                                      <Badge className={getTraceEventStatusClass(currentEvent.status)}>
                                        {getTraceEventStatusLabel(currentEvent.status)}
                                      </Badge>
                                    </div>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      第 {currentEvent.iteration} 轮 · {getTraceEventStageLabel(currentEvent.stage)} · {formatTraceEventTime(currentEvent)}
                                    </p>
                                    {currentEvent.detail && (
                                      <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{currentEvent.detail}</p>
                                    )}
                                  </div>
                                )}

                                {botRun.summary && (
                                  <p className="mt-3 rounded-lg bg-background/70 p-3 text-sm leading-6 text-foreground">{botRun.summary}</p>
                                )}
                                {botRun.error && (
                                  <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{botRun.error}</p>
                                )}

                                <div className="mt-4 grid gap-3">
                                  <details className="group rounded-lg border border-border/50 bg-background/70 p-3" open>
                                    <summary className="cursor-pointer list-none text-sm font-medium text-foreground">
                                      实时执行日志
                                    </summary>
                                    {traceEvents.length > 0 ? (
                                      <ol className="mt-3 space-y-2 border-l border-border/60 pl-3">
                                        {traceEvents.map(renderTraceEvent)}
                                      </ol>
                                    ) : (
                                      <p className="mt-3 text-sm text-muted-foreground">暂无实时执行日志。新审查开始后会逐步写入。</p>
                                    )}
                                  </details>

                                  <details className="group rounded-lg border border-border/50 bg-background/70 p-3" open>
                                    <summary className="cursor-pointer list-none text-sm font-medium text-foreground">
                                      审查过程可视化
                                    </summary>
                                    <div className="mt-3 space-y-4">
                                      {iterations.length > 0 ? iterations.map((iteration, index) => (
                                        <div key={`${botRun.id}-iteration-${index}`} className="rounded-lg bg-sidebar/35 p-3 text-xs">
                                          <div className="flex flex-wrap items-center justify-between gap-2">
                                            <p className="font-medium text-foreground">第 {String(iteration.iteration || index + 1)} 轮</p>
                                            <Badge variant="outline">{getIterationDecisionSummary(iteration).replace(/^决策：/, '')}</Badge>
                                          </div>
                                          <div className="mt-3 grid gap-2 md:grid-cols-5">
                                            {buildReviewProcessStages(iteration).map((stage, stageIndex, stages) => (
                                              renderReviewProcessStage(stage, stageIndex, stageIndex === stages.length - 1)
                                            ))}
                                          </div>
                                          <div className="mt-3 grid gap-2 lg:grid-cols-3">
                                            <p className="rounded-md bg-background/70 p-2 text-muted-foreground">{getIterationToolSummary(iteration)}</p>
                                            <p className="rounded-md bg-background/70 p-2 text-muted-foreground">{getIterationFindingSummary(iteration)}</p>
                                            <p className="rounded-md bg-background/70 p-2 text-muted-foreground">{getIterationContextSummary(iteration)}</p>
                                          </div>
                                        </div>
                                      )) : (
                                        <p className="text-sm text-muted-foreground">暂无 Loop Trace。</p>
                                      )}
                                    </div>
                                  </details>

                                  <details className="group rounded-lg border border-border/50 bg-background/70 p-3">
                                    <summary className="cursor-pointer list-none text-sm font-medium text-foreground">
                                      Final Plan / Critic
                                    </summary>
                                    <div className="mt-3 flex justify-end">
                                      <Button variant="ghost" size="xs" onClick={() => handleCopy(formatJson(botRun.trace), `trace-${botRun.id}`)}>
                                        {copiedKey === `trace-${botRun.id}` ? <><Check className="h-3 w-3" /> 已复制</> : <><Copy className="h-3 w-3" /> 复制</>}
                                      </Button>
                                    </div>
                                    <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-sidebar/50 p-3 text-xs text-muted-foreground whitespace-pre-wrap">
                                      {formatJson({
                                        finalPlan: botRun.trace?.finalPlanJson,
                                        critic: botRun.trace?.criticJson,
                                        memoryUpdates: botRun.trace?.memoryUpdatesJson,
                                      })}
                                    </pre>
                                  </details>
                                </div>

                                {rawReview && (
                                  <details className="mt-3 rounded-lg border border-border/50 bg-background/70 p-3">
                                    <summary className="cursor-pointer list-none text-sm font-medium text-foreground">
                                      Agent 原始评价
                                    </summary>
                                    <div className="mt-3 flex justify-end">
                                      <Button variant="ghost" size="xs" onClick={() => handleCopy(rawReview, `bot-review-${botRun.id}`)}>
                                        {copiedKey === `bot-review-${botRun.id}` ? <><Check className="h-3 w-3" /> 已复制</> : <><Copy className="h-3 w-3" /> 复制</>}
                                      </Button>
                                    </div>
                                    <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-sidebar/50 p-3 text-xs text-muted-foreground whitespace-pre-wrap">
                                      {rawReview}
                                    </pre>
                                  </details>
                                )}
                              </article>
                            )
                          })}
                        </div>
                      ) : (
                        <p className="mt-4 rounded-xl bg-muted p-5 text-sm text-muted-foreground">暂无机器人运行记录。</p>
                      )}
                    </section>

                    <section id="review-raw" className="scroll-mt-4 rounded-2xl border border-border/60 bg-background p-5">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Raw Materials</p>
                        <h2 className="mt-1 text-xl font-semibold">原始回复、Prompt 与模型</h2>
                      </div>

                      <div className="mt-4 space-y-3">
                        <details className="rounded-xl border border-border/50 bg-card/60 p-4">
                          <summary className="cursor-pointer list-none text-sm font-medium text-foreground">AI 原始回复</summary>
                          <div className="mt-3 space-y-4">
                            {selectedReview.aiResponse ? Object.entries(parseAiResponse(selectedReview.aiResponse)).map(([filePath, response]) => (
                              <div key={filePath}>
                                <div className="mb-2 flex items-center justify-between gap-2">
                                  <p className="break-all font-mono text-xs text-muted-foreground">{filePath}</p>
                                  <Button variant="ghost" size="xs" onClick={() => handleCopy(response, `ai-${filePath}`)}>
                                    {copiedKey === `ai-${filePath}` ? <><Check className="h-3 w-3" /> 已复制</> : <><Copy className="h-3 w-3" /> 复制</>}
                                  </Button>
                                </div>
                                <pre className="max-h-96 overflow-auto rounded-md bg-sidebar/50 p-3 text-xs text-muted-foreground whitespace-pre-wrap">{response}</pre>
                              </div>
                            )) : (
                              <p className="text-sm text-muted-foreground">暂无原始回复。</p>
                            )}
                          </div>
                        </details>

                        <details className="rounded-xl border border-border/50 bg-card/60 p-4">
                          <summary className="cursor-pointer list-none text-sm font-medium text-foreground">Prompt 追溯</summary>
                          <div className="mt-3 space-y-4">
                            {selectedReview.reviewPrompts ? Object.entries(parseAiResponse(selectedReview.reviewPrompts)).map(([filePath, prompt]) => (
                              <div key={filePath}>
                                <div className="mb-2 flex items-center justify-between gap-2">
                                  <p className="break-all font-mono text-xs text-muted-foreground">{filePath}</p>
                                  <Button variant="ghost" size="xs" onClick={() => handleCopy(prompt, `prompt-${filePath}`)}>
                                    {copiedKey === `prompt-${filePath}` ? <><Check className="h-3 w-3" /> 已复制</> : <><Copy className="h-3 w-3" /> 复制</>}
                                  </Button>
                                </div>
                                <pre className="max-h-96 overflow-auto rounded-md bg-sidebar/50 p-3 text-xs text-muted-foreground whitespace-pre-wrap">{prompt}</pre>
                              </div>
                            )) : (
                              <p className="text-sm text-muted-foreground">暂无 Prompt 记录。</p>
                            )}
                          </div>
                        </details>

                        <div className="rounded-xl border border-border/50 bg-card/60 p-4">
                          <p className="text-sm font-medium text-foreground">模型信息</p>
                          <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                            <p>提供商：<span className="font-mono text-foreground">{selectedReview.aiModelProvider || 'N/A'}</span></p>
                            <p>模型：<span className="font-mono text-foreground">{selectedReview.aiModelId || 'N/A'}</span></p>
                          </div>
                        </div>
                      </div>
                    </section>
                  </div>
                </main>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
