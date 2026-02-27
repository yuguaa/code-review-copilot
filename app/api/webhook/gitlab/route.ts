/**
 * @file /api/webhook/gitlab
 * @description GitLab Webhook 处理器
 *
 * 支持 Merge Request Hook 和 Push Hook 事件，自动触发代码审查。
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { reviewService } from '@/lib/services/review'
import { createGitLabService } from '@/lib/services/gitlab'

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
    console.log(`🚀 ~ body:`, body)
    const { object_kind, project, object_attributes, ref, checkout_sha, user_username, user } = body

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

      // 获取作者工号和姓名（从 user 字段获取）
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

      // 同一个 MR 的同一个 head commit 只审查一次
      const existingReviewedSameHead = await prisma.reviewLog.findFirst({
        where: {
          repositoryId: repository.id,
          mergeRequestIid: mrIid,
          commitSha,
          status: 'completed',
        },
      })

      if (existingReviewedSameHead) {
        console.log(`⏭️ MR !${mrIid} commit ${commitSha} already reviewed (${existingReviewedSameHead.id})`)
        return NextResponse.json({
          received: true,
          alreadyReviewed: true,
          reviewLogId: existingReviewedSameHead.id,
        })
      }

      // 检查是否有正在进行的审查（避免重复触发）
      // 只检查最近 10 分钟内的 pending 审查
      const recentPendingReview = await prisma.reviewLog.findFirst({
        where: {
          repositoryId: repository.id,
          mergeRequestIid: mrIid,
          status: 'pending',
          startedAt: {
            gte: new Date(Date.now() - 10 * 60 * 1000), // 最近 10 分钟
          },
        },
      })

      if (recentPendingReview) {
        console.log(`⏭️ MR !${mrIid} has a recent pending review (${recentPendingReview.id}), updating and returning existing review`)

        // 更新已有 reviewLog 的信息（可能 MR 标题/描述有变化）
        await prisma.reviewLog.update({
          where: { id: recentPendingReview.id },
          data: {
            title: mr.title,
            description: mr.description,
          },
        })

        // 返回已有的审查 ID，让前端可以跟踪状态
        return NextResponse.json({
          success: true,
          message: 'Review already in progress',
          reviewLogId: recentPendingReview.id,
          existingReview: true,
        })
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
          commitSha: commitSha,
          commitShortId: commitSha.substring(0, 8),
          status: 'pending',
          totalFiles: 0,
        },
      })

      console.log(`✅ Created review log: ${reviewLog.id}`)
      console.log(`🚀 Starting review process...`)

      // 在 GitLab MR 中创建占位评论（后续会被总评更新）
      try {
        const gitlabService = createGitLabService(
          repository.gitLabAccount.url,
          repository.gitLabAccount.accessToken
        )
        const placeholderBody = `## 🔄 Code Review in Progress...\n\n正在进行代码审查，请稍候...\n\n- 📂 正在分析代码变更\n- 🤖 AI 正在审查中\n\n<sub>⏱️ 开始时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</sub>`

        const placeholderResult = await gitlabService.createMergeRequestComment(
          repository.gitLabProjectId,
          mr.iid,
          placeholderBody
        )

        const discussionId = String(placeholderResult.id)
        const noteId = Number.isInteger(placeholderResult?.notes?.[0]?.id)
          ? placeholderResult.notes[0].id
          : null

        await prisma.reviewLog.update({
          where: { id: reviewLog.id },
          data: {
            gitlabDiscussionId: discussionId,
            gitlabNoteId: noteId,
          }
        })
      } catch (error) {
        console.error('⚠️ Failed to create placeholder MR comment:', error)
      }

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

      // 检查是否已经审查过这个提交或正在审查中
      const existingReview = await prisma.reviewLog.findFirst({
        where: {
          repositoryId: repository.id,
          commitSha: commitSha,
        },
      })

      if (existingReview) {
        if (existingReview.status === 'pending') {
          console.log(`⏭️ Commit ${commitSha} has a pending review (${existingReview.id}), returning existing review`)
          return NextResponse.json({
            success: true,
            message: 'Review already in progress',
            reviewLogId: existingReview.id,
            existingReview: true,
          })
        }
        console.log(`⏭️ Commit ${commitSha} already reviewed`)
        return NextResponse.json({ received: true, alreadyReviewed: true })
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

      // Push 事件：创建占位评论，并写入唯一 marker 用于后续回查更新
      try {
        const gitlabService = createGitLabService(
          repository.gitLabAccount.url,
          repository.gitLabAccount.accessToken
        )
        const pushMarker = `CRC_PUSH_PLACEHOLDER:${reviewLog.id}`
        const placeholderBody = `## 🔄 Code Review in Progress...\n\n正在进行代码审查，请稍候...\n\n- 📂 正在分析代码变更\n- 🤖 AI 正在审查中\n\n<!-- ${pushMarker} -->\n<sub>追踪ID: ${pushMarker}</sub>\n<sub>⏱️ 开始时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</sub>`

        const placeholderResult = await gitlabService.createCommitComment(
          repository.gitLabProjectId,
          commitSha,
          placeholderBody
        )

        const noteId = Number.isInteger(placeholderResult?.id)
          ? placeholderResult.id
          : (Number.isInteger(placeholderResult?.note_id) ? placeholderResult.note_id : null)

        // 复用 gitlabDiscussionId 字段保存 push marker，供发布阶段回查使用
        await prisma.reviewLog.update({
          where: { id: reviewLog.id },
          data: {
            gitlabDiscussionId: pushMarker,
            gitlabNoteId: noteId,
          }
        })
      } catch (error) {
        console.error('⚠️ Failed to create placeholder commit comment:', error)
      }

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
