'use client'

import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
  Check
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
  comments: Array<{
    id: string
    filePath: string
    lineNumber: number
    lineRangeEnd?: number | null
    severity: string
    content: string
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
      default:
        return <Badge className="bg-sidebar text-sidebar-foreground border-border/40">{status}</Badge>
    }
  }

  const selectedGitlabLink = selectedReview ? getGitlabLink(selectedReview) : null

  return (
    <div className="p-8">
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
      <Card className="border-border/40">
        <div className="p-6">
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
                      {(review.status === 'failed' || review.status === 'completed') && (
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
                        {(selectedReview.status === 'failed' || selectedReview.status === 'completed') && (
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
