import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type ReviewLogWithRelations = Prisma.ReviewLogGetPayload<{
  include: {
    repository: {
      select: {
        id: true
        name: true
        path: true
        gitLabAccount: {
          select: {
            url: true
          }
        }
      }
    }
    comments: {
      select: {
        id: true
        reviewBotRunId: true
        filePath: true
        lineNumber: true
        lineRangeEnd: true
        severity: true
        content: true
        confidence: true
        sourceBotName: true
        sourceBotModel: true
        sourceBotsJson: true
        isPosted: true
      }
    }
    botRuns: {
      orderBy: { startedAt: 'asc' }
      include: {
        reviewBot: {
          select: {
            id: true
            name: true
            description: true
          }
        }
        agentTrace: {
          select: {
            id: true
            loopIterationsJson: true
            finalPlanJson: true
            criticJson: true
            memoryUpdatesJson: true
            createdAt: true
          }
        }
        comments: {
          select: {
            id: true
            filePath: true
            lineNumber: true
            lineRangeEnd: true
            severity: true
            content: true
            confidence: true
          }
        }
      }
    }
  }
}>

type ReviewGroupKey = {
  repositoryId: string
  mergeRequestIid: number
  commitSha: string
}

const groupKeyOf = (review: ReviewGroupKey) => (
  `${review.repositoryId}:${review.mergeRequestIid}:${review.commitSha}`
)

const diffAnchor = (filePath: string, lineNumber: number, lineRangeEnd?: number | null) => {
  const hash = createHash('sha1').update(filePath).digest('hex')
  const end = lineRangeEnd && lineRangeEnd !== lineNumber ? lineRangeEnd : lineNumber
  return `${hash}_${lineNumber}_${end}`
}

const formatReview = (
  review: ReviewLogWithRelations,
  attempt: { attemptNumber: number; totalAttempts: number },
) => {
  const base = review.repository.gitLabAccount.url.replace(/\/+$/, '')
  const projectPath = review.repository.path
  const ref = review.commitSha || review.sourceBranch
  const mrDiffUrl =
    review.mergeRequestIid && review.mergeRequestIid !== 0
      ? `${base}/${projectPath}/-/merge_requests/${review.mergeRequestIid}/diffs`
      : null
  const commitUrl = `${base}/${projectPath}/-/commit/${ref}`

  return {
    id: review.id,
    repositoryId: review.repositoryId,
    repositoryName: review.repository.name,
    repositoryPath: review.repository.path,
    gitlabUrl: review.repository.gitLabAccount.url,
    mergeRequestId: review.mergeRequestId,
    mergeRequestIid: review.mergeRequestIid,
    sourceBranch: review.sourceBranch,
    targetBranch: review.targetBranch,
    author: review.author,
    authorUsername: review.authorUsername,
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
    aiSummary: review.aiSummary,
    aiResponse: review.aiResponse,
    reviewPrompts: review.reviewPrompts,
    aiModelProvider: review.aiModelProvider,
    aiModelId: review.aiModelId,
    attemptNumber: attempt.attemptNumber,
    totalAttempts: attempt.totalAttempts,
    botRuns: review.botRuns.map((botRun) => ({
      id: botRun.id,
      botName: botRun.reviewBot?.name || '未知机器人',
      botDescription: botRun.reviewBot?.description || null,
      status: botRun.status,
      error: botRun.error,
      summary: botRun.summary,
      aiModelProvider: botRun.aiModelProvider,
      aiModelId: botRun.aiModelId,
      aiModelName: botRun.aiModelName,
      promptSnapshot: botRun.promptSnapshot,
      promptMode: botRun.promptMode,
      startedAt: botRun.startedAt,
      completedAt: botRun.completedAt,
      comments: botRun.comments,
      trace: botRun.agentTrace,
    })),
    startedAt: review.startedAt,
    completedAt: review.completedAt,
    comments: review.comments.map((comment) => {
      const anchor = diffAnchor(comment.filePath, comment.lineNumber, comment.lineRangeEnd)
      const gitlabDiffUrl = mrDiffUrl ? `${mrDiffUrl}#${anchor}` : `${commitUrl}#${anchor}`
      return { ...comment, gitlabDiffUrl }
    }),
    eventType: review.mergeRequestIid === 0 ? 'push' : 'merge_request',
  }
}

/**
 * GET /api/reviews - 获取审查对象列表，按仓库 + MR/Push + commit 聚合
 */
export async function GET(request: NextRequest) {
  try {
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

    const groupRows = await prisma.reviewLog.groupBy({
      by: ['repositoryId', 'mergeRequestIid', 'commitSha'],
      where,
      _max: { startedAt: true },
      _count: { _all: true },
      orderBy: { _max: { startedAt: 'desc' } },
      skip: (page - 1) * limit,
      take: limit,
    })

    const totalGroups = await prisma.reviewLog.groupBy({
      by: ['repositoryId', 'mergeRequestIid', 'commitSha'],
      where,
      _count: { _all: true },
    }).then((groups) => groups.length)

    const groupKeys = groupRows.map((group) => ({
      repositoryId: group.repositoryId,
      mergeRequestIid: group.mergeRequestIid,
      commitSha: group.commitSha,
    }))

    const reviews = groupKeys.length > 0
      ? await prisma.reviewLog.findMany({
        where: {
          OR: groupKeys,
        },
        include: {
          repository: {
            select: {
              id: true,
              name: true,
              path: true,
              gitLabAccount: {
                select: {
                  url: true,
                },
              },
            },
          },
          comments: {
            select: {
              id: true,
              reviewBotRunId: true,
              filePath: true,
              lineNumber: true,
              lineRangeEnd: true,
              severity: true,
              content: true,
              confidence: true,
              sourceBotName: true,
              sourceBotModel: true,
              sourceBotsJson: true,
              isPosted: true,
            },
          },
          botRuns: {
            orderBy: { startedAt: 'asc' },
            include: {
              reviewBot: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                },
              },
              agentTrace: {
                select: {
                  id: true,
                  loopIterationsJson: true,
                  finalPlanJson: true,
                  criticJson: true,
                  memoryUpdatesJson: true,
                  createdAt: true,
                },
              },
              comments: {
                select: {
                  id: true,
                  filePath: true,
                  lineNumber: true,
                  lineRangeEnd: true,
                  severity: true,
                  content: true,
                  confidence: true,
                },
              },
            },
          },
        },
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      })
      : []

    const reviewsByGroup = reviews.reduce((map, review) => {
      const key = groupKeyOf(review)
      const group = map.get(key) || []
      group.push(review)
      map.set(key, group)
      return map
    }, new Map<string, ReviewLogWithRelations[]>())

    const reviewGroups = groupRows.map((group) => {
      const key = groupKeyOf(group)
      const attempts = reviewsByGroup.get(key) || []
      const totalAttempts = group._count._all
      const formattedAttempts = attempts.map((review, index) => (
        formatReview(review, { attemptNumber: index + 1, totalAttempts })
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
  } catch (error) {
    console.error('Failed to fetch reviews:', error)
    return NextResponse.json(
      { error: 'Failed to fetch reviews' },
      { status: 500 }
    )
  }
}
