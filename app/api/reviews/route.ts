import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/reviews - 获取审查记录列表
 * 支持分页和筛选
 */
export async function GET(request: NextRequest) {
  try {
    // 获取查询参数
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '100')  // 默认每页 100 条
    const repositoryId = searchParams.get('repositoryId')
    const status = searchParams.get('status')

    // 构建查询条件
    const where: any = {}
    if (repositoryId) {
      where.repositoryId = repositoryId
    }
    if (status) {
      where.status = status
    }

    // 查询审查记录，包含仓库信息和评论
    const reviews = await prisma.reviewLog.findMany({
      where,
      include: {
        repository: {
          select: {
            id: true,
            name: true,
            path: true,
          },
        },
        comments: {
          select: {
            id: true,
            filePath: true,
            lineNumber: true,
            severity: true,
            content: true,
            isPosted: true,
          },
        },
      },
      orderBy: {
        startedAt: 'desc', // 按开始时间倒序排列
      },
      skip: (page - 1) * limit,
      take: limit,
    })

    // 获取总数用于分页
    const total = await prisma.reviewLog.count({ where })

    // 格式化返回数据
    const formattedReviews = reviews.map((review) => ({
      id: review.id,
      repositoryId: review.repositoryId,
      repositoryName: review.repository.name,
      repositoryPath: review.repository.path,
      mergeRequestId: review.mergeRequestId,
      mergeRequestIid: review.mergeRequestIid,
      sourceBranch: review.sourceBranch,
      targetBranch: review.targetBranch,
      author: review.author,
      authorUsername: review.authorUsername, // 添加工号字段
      title: review.title,
      description: review.description,
      commitSha: review.commitSha,
      commitShortId: review.commitShortId,
      status: review.status,
      error: review.error,
      totalFiles: review.totalFiles,
      reviewedFiles: review.reviewedFiles,
      criticalIssues: review.criticalIssues,
      normalIssues: review.normalIssues,
      suggestions: review.suggestions,
      aiSummary: review.aiSummary, // AI 变更总结
      aiResponse: review.aiResponse, // AI 完整回复（JSON 格式）
      startedAt: review.startedAt,
      completedAt: review.completedAt,
      comments: review.comments,
      // 判断是 Push 还是 MR
      eventType: review.mergeRequestIid === 0 ? 'push' : 'merge_request',
    }))

    return NextResponse.json({
      reviews: formattedReviews,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Failed to fetch reviews:', error)
    return NextResponse.json(
      { error: 'Failed to fetch reviews' },
      { status: 500 }
    )
  }
}
