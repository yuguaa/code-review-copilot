/**
 * @file /api/review/[id]/retry
 * @description 重新触发代码审查
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { reviewService } from '@/lib/services/review'

/**
 * POST /api/review/:id/retry - 重新触发代码审查
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const reviewId = params.id

    // 查找审查记录
    const reviewLog = await prisma.reviewLog.findUnique({
      where: { id: reviewId },
      include: {
        repository: {
          include: {
            gitLabAccount: true,
          },
        },
      },
    })

    if (!reviewLog) {
      return NextResponse.json(
        { error: 'Review log not found' },
        { status: 404 }
      )
    }

    // 检查是否可以重新审查（只有失败或已完成的可以重新审查）
    if (reviewLog.status === 'pending') {
      return NextResponse.json(
        { error: 'Review is already in progress' },
        { status: 400 }
      )
    }

    // 重置审查状态
    await prisma.reviewLog.update({
      where: { id: reviewId },
      data: {
        status: 'pending',
        error: null,
        reviewedFiles: 0,
        criticalIssues: 0,
        normalIssues: 0,
        suggestions: 0,
        aiResponse: null,
        reviewPrompts: null,
        completedAt: null,
        // 清空占位评论 ID，以便重新创建
        gitlabDiscussionId: null,
        gitlabNoteId: null,
      },
    })

    // 删除旧的评论记录
    await prisma.reviewComment.deleteMany({
      where: { reviewLogId: reviewId },
    })

    console.log(`🔄 [RetryAPI] Retrying review: ${reviewId}`)

    // 异步执行审查
    reviewService.performReview(reviewId).catch((error) => {
      console.error('❌ [RetryAPI] Review failed:', error)
    })

    return NextResponse.json({
      success: true,
      message: 'Review restarted',
      reviewLogId: reviewId,
    })
  } catch (error) {
    console.error('❌ [RetryAPI] Failed to retry review:', error)
    return NextResponse.json(
      { error: 'Failed to retry review' },
      { status: 500 }
    )
  }
}
