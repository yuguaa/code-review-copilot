'use client'

import React, { useState, useEffect } from 'react'
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import {
  Clock,
  AlertCircle,
  CheckCircle,
  GitCommit,
  GitMerge,
  Gitlab,
  RefreshCw,
  Copy,
  Check,
  Square
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

export default function ReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedReview, setSelectedReview] = useState<Review | null>(null)
  const [retryingReviewId, setRetryingReviewId] = useState<string | null>(null)
  const [stoppingReviewId, setStoppingReviewId] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  // 分页状态
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 20

  // 获取审查记录
  const fetchReviews = async (page = 1) => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch(`/api/reviews?page=${page}&limit=${pageSize}`)
      if (!response.ok) {
        throw new Error('Failed to fetch reviews')
      }
      const data = await response.json()
      setReviews(data.reviews || [])
      // 更新分页信息
      if (data.pagination) {
        setCurrentPage(data.pagination.page)
        setTotalPages(data.pagination.totalPages)
        setTotal(data.pagination.total)
      }
    } catch (err) {
      console.error('Failed to fetch reviews:', err)
      setError('加载审查记录失败')
    } finally {
      setLoading(false)
    }
  }

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
      
      // 刷新审查记录列表
      await fetchReviews(currentPage)
      
      // 如果当前打开的详情就是这个审查，关闭详情窗口
      if (selectedReview?.id === reviewId) {
        setSelectedReview(null)
      }
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

  // 切换展开/折叠审查详情
  const openReviewDialog = (review: Review) => {
    setSelectedReview(review)
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

  const formatCommentSource = (comment: Review['comments'][number]) => {
    if (Array.isArray(comment.sourceBotsJson) && comment.sourceBotsJson.length > 0) {
      return comment.sourceBotsJson
        .map((source) => {
          if (!source || typeof source !== 'object') return '未知来源'
          const data = source as { botName?: string; model?: string; confidence?: number }
          const confidence = typeof data.confidence === 'number'
            ? `，confidence=${data.confidence.toFixed(2)}`
            : ''
          return `${data.botName || '未知机器人'} / ${data.model || 'unknown'}${confidence}`
        })
        .join('；')
    }

    const confidence = typeof comment.confidence === 'number'
      ? `，confidence=${comment.confidence.toFixed(2)}`
      : ''
    return `${comment.sourceBotName || '默认审查机器人'} / ${comment.sourceBotModel || 'unknown'}${confidence}`
  }

  useEffect(() => {
    fetchReviews()
  }, [])

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
          ) : reviews.length === 0 ? (
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
                {reviews.map((review: Review) => (
                  <TableRow 
                    key={review.id}
                    className="hover:bg-sidebar/50 cursor-pointer"
                    onClick={() => openReviewDialog(review)}
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
                          : `!${review.mergeRequestIid}`}
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
                ))}
              </TableBody>
            </Table>
          )}

          {/* 分页控件 */}
          {!loading && !error && reviews && reviews.length > 0 && totalPages > 1 && (
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

      {/* 审查详情弹窗 */}
      <Dialog open={!!selectedReview} onOpenChange={() => setSelectedReview(null)}>
        <DialogContent className="w-full max-w-[96vw] max-h-[90vh] overflow-hidden p-0 border-border/60 shadow-2xl min-w-0" showCloseButton={true}>
          {selectedReview && (
            <div className="flex flex-col h-[88vh] min-w-0">
              <DialogHeader className="px-6 py-4 border-b border-border/40 bg-sidebar/30">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <DialogTitle className="text-xl font-semibold">
                        审查详情
                      </DialogTitle>
                      <div className="flex items-center gap-2">
                        {getStatusBadge(selectedReview.status)}
                        {selectedReview.status === 'pending' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => stopReview(selectedReview.id, e)}
                            disabled={stoppingReviewId === selectedReview.id}
                            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                          >
                            <Square className="h-3 w-3 mr-1" />
                            {stoppingReviewId === selectedReview.id ? '停止中...' : '停止审查'}
                          </Button>
                        )}
                        {(selectedReview.status === 'failed' || selectedReview.status === 'completed' || selectedReview.status === 'cancelled') && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => retryReview(selectedReview.id, e)}
                            disabled={retryingReviewId === selectedReview.id}
                            className="h-7 px-2 text-xs"
                          >
                            <RefreshCw className={`h-3 w-3 mr-1 ${retryingReviewId === selectedReview.id ? 'animate-spin' : ''}`} />
                            {retryingReviewId === selectedReview.id ? '重审中...' : '重新审查'}
                          </Button>
                        )}
                      </div>
                    </div>
                    <DialogDescription asChild>
                      <div className="mt-2 space-y-3 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{selectedReview.title}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                          <span>仓库：{selectedReview.repositoryName}</span>
                          <span>作者：{selectedReview.author}</span>
                          <span className="flex items-center gap-2">
                            {selectedReview.eventType === 'push'
                              ? `提交：${selectedReview.commitShortId}`
                              : `MR：!${selectedReview.mergeRequestIid}`}
                            {selectedGitlabLink && (
                              <a
                                href={selectedGitlabLink}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-sidebar-primary hover:text-sidebar-primary/80"
                                aria-label={`在 GitLab 中打开${selectedReview.eventType === 'merge_request' ? ' MR' : '提交'}`}
                                title={`在 GitLab 中打开${selectedReview.eventType === 'merge_request' ? ' MR' : '提交'}`}
                              >
                                <Gitlab className="h-4 w-4" />
                              </a>
                            )}
                          </span>
                          <span>
                            分支：{selectedReview.sourceBranch}
                            {selectedReview.targetBranch && ` → ${selectedReview.targetBranch}`}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-xs">
                          <div className="rounded-md border border-border/60 bg-background/60 px-2.5 py-1">
                            开始：{new Date(selectedReview.startedAt).toLocaleString('zh-CN')}
                          </div>
                          <div className="rounded-md border border-border/60 bg-background/60 px-2.5 py-1">
                            用时：{formatDuration(selectedReview.startedAt, selectedReview.completedAt) || '进行中'}
                          </div>
                          <div className="rounded-md border border-border/60 bg-background/60 px-2.5 py-1">
                            变更文件：{selectedReview.reviewedFiles}/{selectedReview.totalFiles}
                          </div>
                          {selectedReview.status === 'completed' && selectedReview.criticalIssues === 0 && selectedReview.normalIssues === 0 && selectedReview.suggestions === 0 && (
                            <div className="rounded-md border border-emerald-600/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-700">
                              LGTM
                            </div>
                          )}
                        </div>
                      </div>
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="px-2 py-4 flex-1 min-h-0 overflow-hidden min-w-0">
                <Tabs
                  defaultValue={
                    selectedReview.aiSummary
                      ? 'summary'
                      : selectedReview.comments?.length
                        ? 'comments'
                        : selectedReview.aiResponse
                          ? 'ai'
                          : selectedReview.reviewPrompts
                            ? 'prompts'
                            : 'model'
                  }
                  className="w-full h-full flex flex-col min-w-0"
                >
                  <TabsList className="mb-4 flex h-10 w-full flex-nowrap gap-2 overflow-x-auto whitespace-nowrap border border-border/40 bg-background/80 p-1 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10 no-scrollbar">
                    <TabsTrigger value="summary" className="h-full">AI 总结</TabsTrigger>
                    <TabsTrigger value="comments" className="h-full">审查意见 {selectedReview.comments?.length ? `(${selectedReview.comments.length})` : ''}</TabsTrigger>
                    <TabsTrigger value="bots" className="h-full">机器人结果 {selectedReview.botRuns?.length ? `(${selectedReview.botRuns.length})` : ''}</TabsTrigger>
                    <TabsTrigger value="ai" className="h-full">AI 原始回复</TabsTrigger>
                    <TabsTrigger value="prompts" className="h-full">Prompt 追溯</TabsTrigger>
                    <TabsTrigger value="model" className="h-full">模型信息</TabsTrigger>
                  </TabsList>

                  <TabsContent value="summary" className="flex-1 min-h-0 overflow-y-auto min-w-0">
                    {selectedReview.aiSummary ? (
                      <div className="bg-background rounded-lg p-4 border border-border/40 overflow-x-auto">
                        <pre className="text-sm text-foreground/90 whitespace-pre-wrap break-words leading-relaxed">
                          {selectedReview.aiSummary}
                        </pre>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground text-sm">暂无 AI 总结</div>
                    )}
                  </TabsContent>

                  <TabsContent value="comments" className="flex-1 min-h-0 overflow-y-auto min-w-0">
                    {selectedReview.comments && selectedReview.comments.length > 0 ? (
                      <div className="bg-background rounded-lg p-4 border border-border/40 overflow-x-auto">
                        <div className="space-y-3">
                          {selectedReview.comments.map((comment) => (
                            <div 
                              key={comment.id}
                              className={`p-3 rounded-md border-l-4 ${getSeverityStyle(comment.severity)}`}
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <span>{getSeverityIcon(comment.severity)}</span>
                                <span className="text-xs font-mono text-muted-foreground inline-flex items-center gap-1">
                                  {comment.filePath}:{comment.lineNumber}
                                  {(() => {
                                    const href =
                                      comment.gitlabDiffUrl ||
                                      getGitlabFileLink(
                                        selectedReview,
                                        comment.filePath,
                                        comment.lineNumber,
                                        comment.lineRangeEnd
                                      )
                                    if (!href) return null
                                    return (
                                      <a
                                        href={href}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-sidebar-primary hover:text-sidebar-primary/80"
                                        aria-label="在 GitLab 中打开该行"
                                        title="在 GitLab 中打开该行"
                                      >
                                        <Gitlab className="h-3.5 w-3.5" />
                                      </a>
                                    )
                                  })()}
                                </span>
                                {comment.isPosted && (
                                  <Badge variant="outline" className="text-xs h-5">
                                    <CheckCircle className="h-3 w-3 mr-1" />
                                    已发布
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-foreground whitespace-pre-wrap">
                                {comment.content}
                              </p>
                              <p className="mt-2 text-xs text-muted-foreground">
                                来源：{formatCommentSource(comment)}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground text-sm space-y-2">
                        <div>暂无可定位的审查意见</div>
                        {(selectedReview.criticalIssues + selectedReview.normalIssues + selectedReview.suggestions) > 0 && (
                          <div className="text-xs">
                            统计：严重 {selectedReview.criticalIssues} / 一般 {selectedReview.normalIssues} / 建议 {selectedReview.suggestions}（可在「AI 原始回复」查看详情）
                          </div>
                        )}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="bots" className="flex-1 min-h-0 overflow-y-auto min-w-0">
                    {selectedReview.botRuns && selectedReview.botRuns.length > 0 ? (
                      <div className="space-y-4">
                        {selectedReview.botRuns.map((botRun) => {
                          const rawReview = extractLastReviewResponse(botRun)
                          return (
                            <div key={botRun.id} className="rounded-lg border border-border/40 bg-background p-4">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <p className="font-medium text-foreground">{botRun.botName}</p>
                                    {getStatusBadge(botRun.status)}
                                  </div>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {botRun.aiModelName} · {botRun.promptMode === 'replace' ? '替换 Prompt' : '扩展 Prompt'}
                                  </p>
                                </div>
                                <div className="flex gap-2">
                                  <Badge variant="outline">问题 {botRun.comments.length}</Badge>
                                  <Badge variant="outline">
                                    轮次 {Array.isArray(botRun.trace?.loopIterationsJson) ? botRun.trace?.loopIterationsJson.length : 0}
                                  </Badge>
                                </div>
                              </div>

                              {botRun.summary && (
                                <p className="mt-3 rounded-md bg-muted p-3 text-sm text-foreground whitespace-pre-wrap">
                                  {botRun.summary}
                                </p>
                              )}

                              {botRun.error && (
                                <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                                  {botRun.error}
                                </p>
                              )}

                              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                                <div className="min-w-0">
                                  <div className="mb-2 flex items-center justify-between">
                                    <p className="text-xs font-medium text-muted-foreground">Agent 原始评价</p>
                                    {rawReview && (
                                      <Button variant="ghost" size="xs" onClick={() => handleCopy(rawReview, `bot-review-${botRun.id}`)}>
                                        {copiedKey === `bot-review-${botRun.id}` ? <><Check className="h-3 w-3" /> 已复制</> : <><Copy className="h-3 w-3" /> 复制</>}
                                      </Button>
                                    )}
                                  </div>
                                  <pre className="max-h-80 overflow-auto rounded-md bg-sidebar/50 p-3 text-xs text-muted-foreground whitespace-pre-wrap">
                                    {rawReview || '暂无原始评价'}
                                  </pre>
                                </div>

                                <div className="min-w-0">
                                  <div className="mb-2 flex items-center justify-between">
                                    <p className="text-xs font-medium text-muted-foreground">Trace / Critic</p>
                                    <Button variant="ghost" size="xs" onClick={() => handleCopy(formatJson(botRun.trace), `bot-trace-${botRun.id}`)}>
                                      {copiedKey === `bot-trace-${botRun.id}` ? <><Check className="h-3 w-3" /> 已复制</> : <><Copy className="h-3 w-3" /> 复制</>}
                                    </Button>
                                  </div>
                                  <pre className="max-h-80 overflow-auto rounded-md bg-sidebar/50 p-3 text-xs text-muted-foreground whitespace-pre-wrap">
                                    {formatJson({
                                      finalPlan: botRun.trace?.finalPlanJson,
                                      critic: botRun.trace?.criticJson,
                                      memoryUpdates: botRun.trace?.memoryUpdatesJson,
                                    })}
                                  </pre>
                                </div>
                              </div>

                              {botRun.comments.length > 0 && (
                                <div className="mt-4 space-y-2">
                                  <p className="text-xs font-medium text-muted-foreground">该机器人发现的问题</p>
                                  {botRun.comments.map((comment) => (
                                    <div key={comment.id} className={`rounded-md border-l-4 p-3 ${getSeverityStyle(comment.severity)}`}>
                                      <p className="text-xs font-mono text-muted-foreground">
                                        {comment.filePath}:{comment.lineNumber}
                                        {comment.lineRangeEnd && comment.lineRangeEnd !== comment.lineNumber ? `-${comment.lineRangeEnd}` : ''}
                                        {typeof comment.confidence === 'number' ? ` · confidence=${comment.confidence.toFixed(2)}` : ''}
                                      </p>
                                      <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">{comment.content}</p>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground text-sm">暂无机器人运行记录</div>
                    )}
                  </TabsContent>

                  <TabsContent value="ai" className="flex-1 min-h-0 overflow-auto min-w-0">
                    {selectedReview.aiResponse ? (
                      <div className="bg-background rounded-lg p-4 border border-border/40 overflow-x-auto">
                        <div className="space-y-4">
                          {Object.entries(parseAiResponse(selectedReview.aiResponse)).map(([filePath, response]) => (
                            <div key={filePath}>
                              <div className="flex items-center justify-between gap-2 mb-2">
                                <p className="text-xs font-mono text-muted-foreground">{filePath}</p>
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  onClick={() => handleCopy(response, `ai-${filePath}`)}
                                >
                                  {copiedKey === `ai-${filePath}` ? (
                                    <>
                                      <Check className="h-3 w-3" /> 已复制
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="h-3 w-3" /> 复制
                                    </>
                                  )}
                                </Button>
                              </div>
                              <pre className="p-3 bg-sidebar/50 rounded-md text-xs text-muted-foreground whitespace-pre min-w-max">
                                {response}
                              </pre>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground text-sm">暂无原始回复</div>
                    )}
                  </TabsContent>

                  <TabsContent value="prompts" className="flex-1 min-h-0 overflow-auto min-w-0">
                    {selectedReview.reviewPrompts ? (
                      <div className="bg-background rounded-lg p-4 border border-border/40 overflow-x-auto">
                        <div className="space-y-4">
                          {Object.entries(parseAiResponse(selectedReview.reviewPrompts)).map(([filePath, prompt]) => (
                            <div key={filePath}>
                              <div className="flex items-center justify-between gap-2 mb-2">
                                <p className="text-xs font-mono text-muted-foreground">{filePath}</p>
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  onClick={() => handleCopy(prompt, `prompt-${filePath}`)}
                                >
                                  {copiedKey === `prompt-${filePath}` ? (
                                    <>
                                      <Check className="h-3 w-3" /> 已复制
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="h-3 w-3" /> 复制
                                    </>
                                  )}
                                </Button>
                              </div>
                              <pre className="p-3 bg-sidebar/50 rounded-md text-xs text-muted-foreground whitespace-pre min-w-max">
                                {prompt}
                              </pre>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground text-sm">暂无 Prompt 记录</div>
                    )}
                  </TabsContent>

                  <TabsContent value="model" className="flex-1 min-h-0 overflow-y-auto min-w-0">
                    {(selectedReview.aiModelProvider || selectedReview.aiModelId) ? (
                      <div className="bg-background rounded-lg p-4 border border-border/40 overflow-x-auto">
                        <div className="text-sm text-muted-foreground space-y-1">
                          <p>提供商: <span className="text-foreground font-mono">{selectedReview.aiModelProvider || 'N/A'}</span></p>
                          <p>模型: <span className="text-foreground font-mono">{selectedReview.aiModelId || 'N/A'}</span></p>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground text-sm">暂无模型信息</div>
                    )}
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
