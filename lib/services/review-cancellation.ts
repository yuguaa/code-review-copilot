import { prisma } from "@/lib/prisma";
import type { ReviewState } from "@/lib/langgraph/types";

export const REVIEW_CANCELLED_STATUS = "cancelled";

export class ReviewCancelledError extends Error {
  constructor(reviewLogId: string) {
    super(`Review ${reviewLogId} was cancelled`);
    this.name = "ReviewCancelledError";
  }
}

export function isReviewCancelledStatus(status: string | null | undefined): boolean {
  return status === REVIEW_CANCELLED_STATUS;
}

export function assertReviewNotCancelled(reviewLogId: string): Promise<void> {
  return prisma.reviewLog.findUnique({
    where: { id: reviewLogId },
    select: { status: true },
  }).then((reviewLog) => {
    if (isReviewCancelledStatus(reviewLog?.status)) {
      throw new ReviewCancelledError(reviewLogId);
    }
  });
}

export function assertStateReviewNotCancelled(state: ReviewState): Promise<ReviewState> {
  return assertReviewNotCancelled(state.reviewLogId).then(() => state);
}
