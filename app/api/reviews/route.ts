import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from "@/lib/logger";
import {
  formatReviewSummary,
  groupKeyOf,
  reviewSummaryInclude,
  type ReviewSummaryRecord,
} from "@/app/api/reviews/review-format";

const log = createLogger("api.reviews");

/**
 * GET /api/reviews - 获取审查对象列表，按仓库 + MR/Push + commit 聚合
 */
export function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '20')
  const repositoryId = searchParams.get('repositoryId')
  const status = searchParams.get('status')

  const where: Prisma.ReviewLogWhereInput = {}
  if (repositoryId) {
    where.repositoryId = repositoryId
  }
  if (status) {
    where.status = status
  }

  return prisma.reviewLog.groupBy({
    by: ['repositoryId', 'mergeRequestIid', 'commitSha'],
    where,
    _max: { startedAt: true },
    _count: { _all: true },
    orderBy: { _max: { startedAt: 'desc' } },
    skip: (page - 1) * limit,
    take: limit,
  }).then((groupRows) => {
    const totalGroupsPromise = prisma.reviewLog.groupBy({
      by: ['repositoryId', 'mergeRequestIid', 'commitSha'],
      where,
      _count: { _all: true },
    }).then((groups) => groups.length)

    const groupKeys = groupRows.map((group) => ({
      repositoryId: group.repositoryId,
      mergeRequestIid: group.mergeRequestIid,
      commitSha: group.commitSha,
    }))

    const reviewsPromise = groupKeys.length > 0
      ? prisma.reviewLog.findMany({
        where: { OR: groupKeys },
        include: reviewSummaryInclude,
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      })
      : Promise.resolve([])

    return Promise.all([totalGroupsPromise, reviewsPromise])
      .then(([totalGroups, reviews]) => {
        const reviewsByGroup = (reviews as ReviewSummaryRecord[]).reduce((map, review) => {
          const key = groupKeyOf(review)
          const group = map.get(key) || []
          group.push(review)
          map.set(key, group)
          return map
        }, new Map<string, ReviewSummaryRecord[]>())

        const reviewGroups = groupRows.map((group) => {
          const key = groupKeyOf(group)
          const attempts = reviewsByGroup.get(key) || []
          const totalAttempts = group._count._all
          const formattedAttempts = attempts.map((review, index) => (
            formatReviewSummary(review, { attemptNumber: index + 1, totalAttempts })
          ))
          const latestReview = formattedAttempts[formattedAttempts.length - 1] || null

          return {
            id: key,
            repositoryId: group.repositoryId,
            mergeRequestIid: group.mergeRequestIid,
            commitSha: group.commitSha,
            totalAttempts,
            latestStartedAt: group._max.startedAt,
            latestReview,
            attempts: [...formattedAttempts].reverse(),
          }
        })

        return NextResponse.json({
          reviewGroups,
          reviews: reviewGroups.map((group) => group.latestReview).filter(Boolean),
          pagination: {
            page,
            limit,
            total: totalGroups,
            totalPages: Math.ceil(totalGroups / limit),
          },
        })
      })
  }).catch((error) => {
    log.error('Failed to fetch reviews:', error)
    return NextResponse.json(
      { error: 'Failed to fetch reviews' },
      { status: 500 }
    )
  })
}
