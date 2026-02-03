/**
 * @file /api/review
 * @description 手动触发代码审查 API
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { reviewService } from '@/lib/services/review'

/** POST /api/review - 手动触发代码审查 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { repositoryId, mergeRequestIid } = body

    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
      include: { gitLabAccount: true },
    })

    if (!repository) {
      return NextResponse.json({ error: 'Repository not found' }, { status: 404 })
    }

    const { createGitLabService } = await import('@/lib/services/gitlab')
    const gitlabService = createGitLabService(
      repository.gitLabAccount.url,
      repository.gitLabAccount.accessToken
    )

    const mr = await gitlabService.getMergeRequest(repository.gitLabProjectId, mergeRequestIid)

    const reviewLog = await prisma.reviewLog.create({
      data: {
        repositoryId: repository.id,
        mergeRequestId: mr.id,
        mergeRequestIid: mr.iid,
        sourceBranch: mr.source_branch,
        targetBranch: mr.target_branch,
        author: mr.author?.name || mr.author?.username || 'unknown',
        authorUsername: mr.author?.username,
        title: mr.title,
        description: mr.description,
        commitSha: mr.diff_refs.head_sha,
        commitShortId: mr.diff_refs.head_sha.substring(0, 8),
        status: 'pending',
        totalFiles: 0,
      },
    })

    reviewService.performReview(reviewLog.id).catch((error) => {
      console.error('Review failed:', error)
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
