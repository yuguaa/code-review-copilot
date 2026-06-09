import { createLogger } from "@/lib/logger";

const log = createLogger("api.review.[id].retry");
/**
 * @file /api/review/[id]/retry
 * @description 重新触发代码审查
 */

import { NextRequest, NextResponse } from 'next/server'
import { reviewTriggerService } from '@/lib/services/review-trigger'

/**
 * POST /api/review/:id/retry - 重新触发代码审查
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: reviewId } = await params

    log.info(`🔄 [RetryAPI] Retrying review: ${reviewId}`)
    const reviewLog = await reviewTriggerService.retryReview(reviewId)

    return NextResponse.json({
      success: true,
      message: 'Review restarted',
      reviewLogId: reviewLog.id,
      sourceReviewLogId: reviewId,
    })
  } catch (error) {
    log.error('❌ [RetryAPI] Failed to retry review:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to retry review' },
      { status: error instanceof Error && error.message.includes('progress') ? 400 : 500 }
    )
  }
}
