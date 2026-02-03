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
  Clock, 
  AlertCircle, 
  ExternalLink, 
  CheckCircle, 
  GitCommit, 
  GitMerge, 
  RefreshCw,
  ChevronDown,
  ChevronUp,
  FileText,
  Bot
} from 'lucide-react'

// 审查记录类型定义
interface Review {
  id: string
  repositoryId: string
  repositoryName: string
  repositoryPath: string
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
  startedAt: string
  completedAt: string | null
  eventType: 'push' | 'merge_request'
  comments: Array<{
    id: string
    filePath: string
    lineNumber: number
    severity: string
    content: string
    isPosted: boolean
  }>
}

export default function ReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([])  // 初始化为空数组
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedReviewId, setExpandedReviewId] = useState<string | null>(null) // 展开的审查记录 ID
  // 分页状态
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 20 // 每页 20 条

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

  // 切换展开/折叠审查详情
  const toggleExpand = (reviewId: string) => {
    setExpandedReviewId(expandedReviewId === reviewId ? null : reviewId)
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
                  <TableHead className="h-10 px-4 text-xs font-semibold text-muted-foreground w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviews.map((review: Review) => (
                  <React.Fragment key={review.id}>
                  <TableRow 
                    className={`hover:bg-sidebar/50 cursor-pointer ${expandedReviewId === review.id ? 'bg-sidebar/30' : ''}`}
                    onClick={() => toggleExpand(review.id)}
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
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        {expandedReviewId === review.id ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                  
                  {/* 展开的详情面板 */}
                  {expandedReviewId === review.id && (
                    <TableRow key={`${review.id}-details`} className="bg-sidebar/20 hover:bg-sidebar/20">
                      <TableCell colSpan={9} className="px-6 py-4">
                        <div className="space-y-4">
                          {/* AI 变更总结 */}
                          {review.aiSummary && (
                            <div className="bg-background rounded-lg p-4 border border-border/40">
                              <div className="flex items-center gap-2 mb-3">
                                <Bot className="h-5 w-5 text-sidebar-primary" />
                                <h4 className="font-medium text-foreground">AI 变更总结</h4>
                              </div>
                              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                                {review.aiSummary}
                              </p>
                            </div>
                          )}

                          {/* 审查评论列表 */}
                          {review.comments && review.comments.length > 0 && (
                            <div className="bg-background rounded-lg p-4 border border-border/40">
                              <div className="flex items-center gap-2 mb-3">
                                <FileText className="h-5 w-5 text-sidebar-primary" />
                                <h4 className="font-medium text-foreground">审查意见 ({review.comments.length})</h4>
                              </div>
                              <div className="space-y-3">
                                {review.comments.map((comment) => (
                                  <div 
                                    key={comment.id}
                                    className={`p-3 rounded-md border-l-4 ${getSeverityStyle(comment.severity)}`}
                                  >
                                    <div className="flex items-center gap-2 mb-2">
                                      <span>{getSeverityIcon(comment.severity)}</span>
                                      <span className="text-xs font-mono text-muted-foreground">
                                        {comment.filePath}:{comment.lineNumber}
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
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* AI 原始回复（按文件） */}
                          {review.aiResponse && (
                            <div className="bg-background rounded-lg p-4 border border-border/40">
                              <div className="flex items-center gap-2 mb-3">
                                <Bot className="h-5 w-5 text-muted-foreground" />
                                <h4 className="font-medium text-foreground">AI 原始回复</h4>
                              </div>
                              <div className="space-y-3">
                                {Object.entries(parseAiResponse(review.aiResponse)).map(([filePath, response]) => (
                                  <details key={filePath} className="group">
                                    <summary className="cursor-pointer text-sm font-mono text-muted-foreground hover:text-foreground flex items-center gap-2">
                                      <ChevronDown className="h-4 w-4 group-open:rotate-180 transition-transform" />
                                      {filePath}
                                    </summary>
                                    <pre className="mt-2 p-3 bg-sidebar/50 rounded-md text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap">
                                      {response}
                                    </pre>
                                  </details>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* 无审查内容提示 */}
                          {!review.aiSummary && (!review.comments || review.comments.length === 0) && !review.aiResponse && (
                            <div className="text-center py-4 text-muted-foreground">
                              <p className="text-sm">暂无审查详情</p>
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  </React.Fragment>
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
    </div>
  )
}
