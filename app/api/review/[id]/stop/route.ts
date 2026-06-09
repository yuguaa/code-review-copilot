import { createLogger } from "@/lib/logger";

const log = createLogger("api.review.[id].stop");
/**
 * @file /api/review/[id]/stop
 * @description 手动停止进行中的代码审查
 */

import { NextRequest, NextResponse } from 'next/server'
import { reviewTriggerService } from '@/lib/services/review-trigger'

/**
 * POST /api/review/:id/stop - 停止进行中的代码审查
 */
export function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return params.then(({ id: reviewId }) => {
    log.info(`🛑 [StopAPI] Stopping review: ${reviewId}`)
    return reviewTriggerService.stopReview(reviewId)
  }).then((reviewLog) => {
    return NextResponse.json({
      success: true,
      message: 'Review stopped',
      reviewLogId: reviewLog.id,
      status: reviewLog.status,
    })
  }).catch((error) => {
    log.error('❌ [StopAPI] Failed to stop review:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to stop review' },
      { status: error instanceof Error && error.message.includes('pending') ? 400 : 500 }
    )
  })
}
