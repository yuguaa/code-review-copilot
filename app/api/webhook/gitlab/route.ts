import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { reviewService } from '@/lib/services/review'
import crypto from 'crypto'

// POST /api/webhook/gitlab - 处理 GitLab Webhook
export async function POST(request: NextRequest) {
  try {
    // 获取 webhook 事件类型
    const event = request.headers.get('x-gitlab-event')

    if (!event) {
      return NextResponse.json(
        { error: 'Missing X-GitLab-Event header' },
        { status: 400 }
      )
    }

    // 只处理 Merge Request 事件
    if (event !== 'Merge Request Hook') {
      return NextResponse.json({ received: true })
    }

    const body = await request.json()
    const { object_kind, event_type, project, object_attributes } = body

    // 验证是否是 MR 事件
    if (object_kind !== 'merge_request' && event_type !== 'merge_request') {
      return NextResponse.json({ received: true })
    }

    const mr = object_attributes
    const projectId = project.id
    const mrIid = mr.iid
    const action = mr.action

    // 只处理新建或更新的 MR
    if (!['open', 'update', 'reopen'].includes(action)) {
      return NextResponse.json({ received: true })
    }

    // 查找对应的仓库配置
    const repository = await prisma.repository.findFirst({
      where: {
        gitLabProjectId: projectId,
        isActive: true,
      },
      include: {
        gitLabAccount: true,
        branchConfigs: {
          where: { isActive: true },
        },
      },
    })

    if (!repository) {
      console.log(`No repository found for project ${projectId}`)
      return NextResponse.json({ received: true })
    }

    // 检查是否启用了自动审查
    if (!repository.autoReview) {
      console.log(`Auto-review is disabled for repository ${repository.id}`)
      return NextResponse.json({ received: true })
    }

    // 查找匹配的分支配置
    const branchConfig = repository.branchConfigs.find((config: any) => {
      const pattern = config.branchPattern.replace('*', '.*')
      const regex = new RegExp(`^${pattern}$`)
      return regex.test(mr.source_branch)
    })

    if (!branchConfig) {
      console.log(`No matching branch config for ${mr.source_branch}`)
      return NextResponse.json({ received: true })
    }

    // 检查是否已经审查过这个 MR
    const existingReview = await prisma.reviewLog.findFirst({
      where: {
        repositoryId: repository.id,
        mergeRequestIid: mrIid,
        commitSha: mr.diff_refs.head_sha,
      },
    })

    if (existingReview) {
      console.log(`MR ${mrIid} already reviewed for commit ${mr.diff_refs.head_sha}`)
      return NextResponse.json({ received: true })
    }

    // 创建审查日志
    const reviewLog = await prisma.reviewLog.create({
      data: {
        repositoryId: repository.id,
        branchConfigId: branchConfig.id,
        mergeRequestId: mr.id,
        mergeRequestIid: mr.iid,
        sourceBranch: mr.source_branch,
        targetBranch: mr.target_branch,
        author: mr.author.username,
        title: mr.title,
        description: mr.description,
        commitSha: mr.diff_refs.head_sha,
        commitShortId: mr.diff_refs.head_sha.substring(0, 8),
        status: 'pending',
        totalFiles: 0,
      },
    })

    // 异步执行审查
    reviewService.performReview(reviewLog.id).catch((error) => {
      console.error('Review failed:', error)
    })

    return NextResponse.json({
      success: true,
      message: 'Review started',
    })
  } catch (error) {
    console.error('Webhook processing failed:', error)
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    )
  }
}
