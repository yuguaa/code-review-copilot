/**
 * @file /api/webhook/gitlab
 * @description GitLab Webhook 处理器
 *
 * 支持 Merge Request Hook 和 Push Hook 事件，自动触发代码审查。
 */

import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { reviewTriggerService } from '@/lib/services/review-trigger'

/**
 * 检查分支是否匹配监听规则
 * @param sourceBranch - 源分支名称
 * @param watchBranches - 监听规则（逗号分隔，支持通配符 *）
 */
function checkBranchMatch(sourceBranch: string, watchBranches: string | null): boolean {
  if (!watchBranches || watchBranches.trim() === '') {
    return true
  }

  const patterns = watchBranches.split(',').map(p => p.trim())

  return patterns.some(pattern => {
    const regexPattern = pattern.replace(/\*/g, '.*')
    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(sourceBranch)
  })
}

function isValidWebhookSecret(configuredSecret: string | null | undefined, receivedSecret: string | null): boolean {
  const normalizedConfigured = configuredSecret?.trim()
  if (!normalizedConfigured) return true
  if (!receivedSecret) return false

  const configuredBuffer = Buffer.from(normalizedConfigured)
  const receivedBuffer = Buffer.from(receivedSecret.trim())
  if (configuredBuffer.length !== receivedBuffer.length) return false
  return crypto.timingSafeEqual(configuredBuffer, receivedBuffer)
}

/** POST /api/webhook/gitlab - 处理 GitLab Webhook */
export async function POST(request: NextRequest) {
  console.log(' ')
  console.log('%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%')
  console.log('%%%    🤖WEBHOOK REQUEST RECEIVED    %%%')
  console.log('%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%')
  console.log(' ')

  try {
    // 获取 webhook 事件类型
    const event = request.headers.get('x-gitlab-event')
    console.log('>>> Event header:', event)

    if (!event) {
      console.error('❌ Missing X-GitLab-Event header')
      return NextResponse.json(
        { error: 'Missing X-GitLab-Event header' },
        { status: 400 }
      )
    }

    // 处理不同类型的事件
    const body = await request.json()
    const { object_kind, project, object_attributes, ref, before, checkout_sha, user_username, user } = body

    const projectId = project?.id
    console.log('Looking for repository with gitLabProjectId:', projectId)

    if (!projectId) {
      console.error('❌ Missing project id')
      return NextResponse.json({ error: 'Missing project id' }, { status: 400 })
    }

    // 查找对应的仓库配置
    const repository = await prisma.repository.findFirst({
      where: {
        gitLabProjectId: projectId,
        isActive: true,
      },
      include: {
        gitLabAccount: true,
      },
    })

    if (!repository) {
      console.log(`❌ No repository found for project ${projectId}`)
      return NextResponse.json({ received: true })
    }

    if (!isValidWebhookSecret(repository.gitLabAccount.webhookSecret, request.headers.get('x-gitlab-token'))) {
      console.error('❌ Invalid GitLab webhook secret')
      return NextResponse.json({ error: 'Invalid webhook secret' }, { status: 401 })
    }

    console.log(`✅ Found repository: ${repository.name} (${repository.id})`)
    console.log(`🔧 Auto-review enabled: ${repository.autoReview}`)
    console.log(`👀 Watch branches: ${repository.watchBranches || 'all branches'}`)

    // 检查是否启用了自动审查
    if (!repository.autoReview) {
      console.log(`⏭️ Auto-review is disabled for repository ${repository.id}`)
      return NextResponse.json({ received: true })
    }

    // 处理 Merge Request 事件
    if (event === 'Merge Request Hook' || object_kind === 'merge_request') {
      const mr = object_attributes
      const mrIid = mr.iid
      const action = mr.action

      const mrAuthorUsername = user?.username || user_username || 'unknown'
      const mrAuthorName = user?.name || ''
      const mrAuthor = mrAuthorName ? `${mrAuthorName}(${mrAuthorUsername})` : mrAuthorUsername

      console.log(`🔀 MR Event: ${action} !${mrIid}`)
      console.log(`📂 Source branch: ${mr.source_branch} → Target branch: ${mr.target_branch}`)
      console.log(`👤 Author: ${mrAuthor}`)
      console.log(`📝 Title: ${mr.title}`)

      // 跳过已合并、关闭的 MR 事件
      if (['merge', 'merged', 'close', 'closed'].includes(action)) {
        console.log(`⏭️ Skipping MR action: ${action} (merged/closed MRs are not reviewed)`)
        return NextResponse.json({ received: true })
      }

      // 检查分支是否匹配监听规则（MR 事件检查目标分支）
      const shouldReview = checkBranchMatch(mr.target_branch, repository.watchBranches)
      if (!shouldReview) {
        console.log(`⏭️ Target branch ${mr.target_branch} does not match watch rules: ${repository.watchBranches}`)
        return NextResponse.json({ received: true })
      }

      console.log(`✅ Target branch ${mr.target_branch} matches watch rules`)

      // 获取 commit SHA（优先使用 diff_refs，否则使用 last_commit）
      const commitSha = mr.diff_refs?.head_sha || mr.last_commit?.id
      if (!commitSha) {
        console.error('❌ Cannot find commit SHA in MR event')
        return NextResponse.json({ error: 'Missing commit SHA' }, { status: 400 })
      }

      const reviewLog = await reviewTriggerService.startWebhookMergeRequestReview({
        repository,
        mergeRequest: mr,
        commitSha,
        authorName: mrAuthorName,
        authorUsername: mrAuthorUsername,
      })

      return NextResponse.json({
        success: true,
        message: 'Review started',
        reviewLogId: reviewLog.id,
      })
    }

    // 处理 Push 事件（代码提交）
    if (event === 'Push Hook' || object_kind === 'push') {
      const branchName = ref?.replace('refs/heads/', '')
      const commitSha = checkout_sha
      const baseCommitSha = typeof before === 'string' && before.trim() ? before : null
      const pushCommitShas = Array.isArray(body.commits)
        ? body.commits
          .map((commit: { id?: unknown }) => commit.id)
          .filter((id: unknown): id is string => typeof id === 'string' && Boolean(id.trim()))
        : []
      // 获取作者工号和姓名
      const authorUsername = body.user_username || 'unknown'
      const authorName = body.user_name || ''
      // 格式：姓名(工号) 或 仅工号
      const author = authorName ? `${authorName}(${authorUsername})` : authorUsername

      console.log(`📝 Push Event`)
      console.log(`📂 Branch: ${branchName}`)
      console.log(`🔙 Before: ${baseCommitSha || 'N/A'}`)
      console.log(`💾 Commit: ${commitSha}`)
      console.log(`📦 Push commits: ${pushCommitShas.length}`)
      console.log(`👤 Author: ${author}`)

      if (!branchName || !commitSha) {
        console.error('❌ Invalid push event data')
        return NextResponse.json({ error: 'Invalid push event data' }, { status: 400 })
      }

      // 检查分支是否匹配监听规则
      const shouldReview = checkBranchMatch(branchName, repository.watchBranches)
      if (!shouldReview) {
        console.log(`⏭️ Branch ${branchName} does not match watch rules: ${repository.watchBranches}`)
        return NextResponse.json({ received: true })
      }

      console.log(`✅ Branch ${branchName} matches watch rules`)

      const reviewLog = await reviewTriggerService.startWebhookPushReview({
        repository,
        branchName,
        baseCommitSha,
        pushCommitShas,
        commitSha,
        authorName,
        authorUsername,
      })

      return NextResponse.json({
        success: true,
        message: 'Review started',
        reviewLogId: reviewLog.id,
      })
    }

    // 其他事件类型不处理
    console.log(`⏭️ Unhandled event type: ${event} / ${object_kind}`)
    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('❌ Webhook processing failed:', error)
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    )
  }
}
