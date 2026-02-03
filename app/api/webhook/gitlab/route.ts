import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { reviewService } from '@/lib/services/review'
import crypto from 'crypto'

/**
 * 检查分支是否匹配监听规则
 * @param sourceBranch 源分支名称
 * @param watchBranches 监听规则（逗号分隔，支持通配符 *）
 * @returns 是否匹配
 */
function checkBranchMatch(sourceBranch: string, watchBranches: string | null): boolean {
  // 如果没有设置监听规则，默认监听所有分支
  if (!watchBranches || watchBranches.trim() === '') {
    return true
  }

  // 分割多个规则
  const patterns = watchBranches.split(',').map(p => p.trim())

  // 检查是否匹配任意一个规则
  return patterns.some(pattern => {
    // 将通配符 * 转换为正则表达式
    const regexPattern = pattern.replace(/\*/g, '.*')
    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(sourceBranch)
  })
}

// POST /api/webhook/gitlab - 处理 GitLab Webhook
export async function POST(request: NextRequest) {
  console.log(' ')
  console.log('%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%')
  console.log('%%%    WEBHOOK REQUEST RECEIVED    %%%')
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
    console.log('=== WEBHOOK BODY ===')
    console.log(JSON.stringify(body, null, 2))
    console.log('===================')

    const { object_kind, project, object_attributes, ref, checkout_sha, user_username } = body

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

      // 获取作者工号和姓名
      const mrAuthorUsername = mr.author?.username || 'unknown'
      const mrAuthorName = mr.author?.name || ''
      const mrAuthor = mrAuthorName ? `${mrAuthorName}(${mrAuthorUsername})` : mrAuthorUsername

      console.log(`🔀 MR Event: ${action} !${mrIid}`)
      console.log(`📂 Source branch: ${mr.source_branch} → Target branch: ${mr.target_branch}`)
      console.log(`👤 Author: ${mrAuthor}`)
      console.log(`📝 Title: ${mr.title}`)

      // 只处理新建或更新的 MR
      if (!['open', 'update', 'reopen'].includes(action)) {
        console.log(`⏭️ Skipping MR action: ${action}`)
        return NextResponse.json({ received: true })
      }

      // 检查分支是否匹配监听规则
      const shouldReview = checkBranchMatch(mr.source_branch, repository.watchBranches)
      if (!shouldReview) {
        console.log(`⏭️ Branch ${mr.source_branch} does not match watch rules: ${repository.watchBranches}`)
        return NextResponse.json({ received: true })
      }

      console.log(`✅ Branch ${mr.source_branch} matches watch rules`)

      // 检查是否已经审查过这个 MR
      const existingReview = await prisma.reviewLog.findFirst({
        where: {
          repositoryId: repository.id,
          mergeRequestIid: mrIid,
          commitSha: mr.diff_refs.head_sha,
        },
      })

      if (existingReview) {
        console.log(`⏭️ MR !${mrIid} already reviewed for commit ${mr.diff_refs.head_sha}`)
        return NextResponse.json({ received: true })
      }

      // 创建审查日志
      const reviewLog = await prisma.reviewLog.create({
        data: {
          repositoryId: repository.id,
          mergeRequestId: mr.id,
          mergeRequestIid: mr.iid,
          sourceBranch: mr.source_branch,
          targetBranch: mr.target_branch,
          author: mrAuthorName || mrAuthorUsername, // 姓名，如果没有则用工号
          authorUsername: mrAuthorUsername, // 工号
          title: mr.title,
          description: mr.description,
          commitSha: mr.diff_refs.head_sha,
          commitShortId: mr.diff_refs.head_sha.substring(0, 8),
          status: 'pending',
          totalFiles: 0,
        },
      })

      console.log(`✅ Created review log: ${reviewLog.id}`)
      console.log(`🚀 Starting review process...`)

      // 异步执行审查
      reviewService.performReview(reviewLog.id).catch((error) => {
        console.error('❌ Review failed:', error)
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
      // 获取作者工号和姓名
      const authorUsername = body.user_username || 'unknown'
      const authorName = body.user_name || ''
      // 格式：姓名(工号) 或 仅工号
      const author = authorName ? `${authorName}(${authorUsername})` : authorUsername

      console.log(`📝 Push Event`)
      console.log(`📂 Branch: ${branchName}`)
      console.log(`💾 Commit: ${commitSha}`)
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

      // 检查是否已经审查过这个提交
      const existingReview = await prisma.reviewLog.findFirst({
        where: {
          repositoryId: repository.id,
          commitSha: commitSha,
        },
      })

      if (existingReview) {
        console.log(`⏭️ Commit ${commitSha} already reviewed`)
        return NextResponse.json({ received: true })
      }

      // 创建审查日志（Push 事件没有 mergeRequestId 等信息）
      const reviewLog = await prisma.reviewLog.create({
        data: {
          repositoryId: repository.id,
          mergeRequestId: 0,
          mergeRequestIid: 0,
          sourceBranch: branchName,
          targetBranch: '',
          author: authorName || authorUsername, // 姓名，如果没有则用工号
          authorUsername: authorUsername, // 工号
          title: `Push to ${branchName}`,
          description: null,
          commitSha: commitSha,
          commitShortId: commitSha.substring(0, 8),
          status: 'pending',
          totalFiles: 0,
        },
      })

      console.log(`✅ Created review log: ${reviewLog.id}`)
      console.log(`🚀 Starting review process...`)

      // 异步执行审查
      reviewService.performReview(reviewLog.id).catch((error) => {
        console.error('❌ Review failed:', error)
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
