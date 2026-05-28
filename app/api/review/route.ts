/**
 * @file /api/review
 * @description 手动触发代码审查 API
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { reviewTriggerService } from '@/lib/services/review-trigger'

/** POST /api/review - 手动触发代码审查 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { repositoryId, mergeRequestIid } = body

    if (!repositoryId || !mergeRequestIid) {
      return NextResponse.json(
        { error: 'Repository ID and merge request IID are required' },
        { status: 400 }
      )
    }

    const reviewLog = await reviewTriggerService.startManualReview({
      repositoryId,
      mergeRequestIid: Number(mergeRequestIid),
    })

    return NextResponse.json({
      success: true,
      reviewLogId: reviewLog.id,
      message: 'Review started',
    })
  } catch (error) {
    console.error('Failed to start review:', error)
    return NextResponse.json({ error: 'Failed to start review' }, { status: 500 })
  }
}

/** GET /api/review?logId=xxx - 获取审查状态 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const logId = searchParams.get('logId')

    if (!logId) {
      return NextResponse.json(
        { error: 'Review log ID is required' },
        { status: 400 }
      )
    }

    const reviewLog = await prisma.reviewLog.findUnique({
      where: { id: logId },
      include: {
        comments: true,
      },
    })

    if (!reviewLog) {
      return NextResponse.json(
        { error: 'Review log not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(reviewLog)
  } catch (error) {
    console.error('Failed to fetch review log:', error)
    return NextResponse.json(
      { error: 'Failed to fetch review log' },
      { status: 500 }
    )
  }
}
