import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import {
  formatReviewDetail,
  groupKeyOf,
  reviewDetailInclude,
  reviewSummaryInclude,
  type ReviewDetailRecord,
} from "@/app/api/reviews/review-format";

const log = createLogger("api.reviews.[id]");

type AttemptSource = {
  id: string;
  repositoryId: string;
  mergeRequestIid: number;
  commitSha: string;
};

function attemptMeta(review: AttemptSource) {
  return prisma.reviewLog.findMany({
    where: {
      repositoryId: review.repositoryId,
      mergeRequestIid: review.mergeRequestIid,
      commitSha: review.commitSha,
    },
    include: reviewSummaryInclude,
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
  }).then((attempts) => {
    const index = attempts.findIndex((item) => item.id === review.id);
    return {
      group: {
        id: groupKeyOf(review),
        repositoryId: review.repositoryId,
        mergeRequestIid: review.mergeRequestIid,
        commitSha: review.commitSha,
        totalAttempts: attempts.length,
        latestStartedAt: attempts.at(-1)?.startedAt || null,
        latestReview: attempts.at(-1)
          ? {
            id: attempts.at(-1)!.id,
            status: attempts.at(-1)!.status,
            startedAt: attempts.at(-1)!.startedAt,
          }
          : null,
      },
      attempt: {
        attemptNumber: index >= 0 ? index + 1 : attempts.length,
        totalAttempts: attempts.length,
      },
    };
  });
}

function findReviewDetail(id: string): Promise<ReviewDetailRecord | null> {
  return prisma.reviewLog.findUnique({
    where: { id },
    include: reviewDetailInclude,
  }) as Promise<ReviewDetailRecord | null>;
}

function buildReviewDetailResponse(review: ReviewDetailRecord): Promise<Response> {
  return attemptMeta(review)
    .then(({ group, attempt }) => NextResponse.json({
      review: formatReviewDetail(review, attempt),
      group,
    }));
}

export function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return params.then(({ id }) => {
    return findReviewDetail(id);
  }).then((review) => {
    if (!review) {
      return Promise.resolve(NextResponse.json({ error: "Review not found" }, { status: 404 }));
    }

    return buildReviewDetailResponse(review);
  }).catch((error) => {
    log.error("Failed to fetch review detail:", error);
    return NextResponse.json(
      { error: "Failed to fetch review detail" },
      { status: 500 },
    );
  });
}
