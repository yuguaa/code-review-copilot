import { prisma } from '@/lib/prisma'
import { createGitLabService } from './gitlab'
import { aiService } from './ai'
import { buildReviewPrompt, buildSummaryPrompt, SYSTEM_PROMPT } from '@/lib/prompts'
import type { AIModelConfig, ReviewComment } from '@/lib/types'

export class ReviewService {
  /**
   * 执行代码审查
   */
  async performReview(reviewLogId: string) {
    console.log(`🔍 [ReviewService] Starting review for log: ${reviewLogId}`)

    const reviewLog = await prisma.reviewLog.findUnique({
      where: { id: reviewLogId },
      include: {
        repository: {
          include: {
            gitLabAccount: true,
            defaultAIModel: true,
          },
        },
      },
    })

    if (!reviewLog) {
      console.error(`❌ [ReviewService] Review log not found: ${reviewLogId}`)
      throw new Error('Review log not found')
    }

    console.log(`📋 [ReviewService] Review: ${reviewLog.title}`)
    console.log(`📂 [ReviewService] Branch: ${reviewLog.sourceBranch} → ${reviewLog.targetBranch || 'N/A'}`)

    try {
      // 更新状态为进行中
      await prisma.reviewLog.update({
        where: { id: reviewLogId },
        data: { status: 'pending' },
      })
      console.log(`🔄 [ReviewService] Status updated to: pending`)

      // 创建 GitLab 服务
      const gitlabService = createGitLabService(
        reviewLog.repository.gitLabAccount.url,
        reviewLog.repository.gitLabAccount.accessToken
      )

      // 区分 MR 和 Push 事件
      const isPushEvent = reviewLog.mergeRequestIid === 0

      let mr: any = null
      let diffs: any[] = []

      if (isPushEvent) {
        // Push 事件：直接获取提交的 diff
        console.log(`📌 [ReviewService] Processing Push event for commit: ${reviewLog.commitSha}`)
        diffs = await gitlabService.getCommitDiff(
          reviewLog.repository.gitLabProjectId,
          reviewLog.commitSha
        )
      } else {
        // MR 事件：获取 MR 详情和 commits
        mr = await gitlabService.getMergeRequest(
          reviewLog.repository.gitLabProjectId,
          reviewLog.mergeRequestIid
        )

        // 获取最新一次提交的 diff
        const commits = await gitlabService.getMergeRequestCommits(
          reviewLog.repository.gitLabProjectId,
          reviewLog.mergeRequestIid
        )

        if (!commits || commits.length === 0) {
          throw new Error('No commits found in merge request')
        }

        const latestCommit = commits[0]
        diffs = await gitlabService.getCommitDiff(
          reviewLog.repository.gitLabProjectId,
          latestCommit.id
        )
      }

      // 过滤掉删除的文件
      const relevantDiffs = diffs.filter((diff) => !diff.deleted_file)

      console.log(`📁 [ReviewService] Total files changed: ${diffs.length}`)
      console.log(`📁 [ReviewService] Files to review: ${relevantDiffs.length}`)

      // 更新文件总数
      await prisma.reviewLog.update({
        where: { id: reviewLogId },
        data: { totalFiles: relevantDiffs.length },
      })

      // 准备 AI 模型配置 - 优先使用自定义模型配置，其次使用默认模型
      const repository = reviewLog.repository
      const modelConfig: AIModelConfig = {
        id: repository.customProvider ? 'custom' : (repository.defaultAIModel?.id || 'default'),
        name: repository.customModelId || repository.defaultAIModel?.modelId || 'default',
        provider: (repository.customProvider || repository.defaultAIModel?.provider || 'openai') as any,
        modelId: repository.customModelId || repository.defaultAIModel?.modelId || 'gpt-4o',
        apiKey: repository.customApiKey || repository.defaultAIModel?.apiKey || '',
        apiEndpoint: repository.customApiEndpoint || repository.defaultAIModel?.apiEndpoint || undefined,
        maxTokens: repository.customMaxTokens || repository.defaultAIModel?.maxTokens || undefined,
        temperature: repository.customTemperature || repository.defaultAIModel?.temperature || undefined,
        isActive: true,
      }

      console.log(`🤖 [ReviewService] Using AI model: ${modelConfig.provider}/${modelConfig.modelId}`)

      // 首先总结所有变更
      const allDiffsText = diffs.map((d) => d.diff).join('\n')
      const summaryPrompt = buildSummaryPrompt({
        title: mr?.title || reviewLog.title,
        description: mr?.description || reviewLog.description || '',
        diffs: allDiffsText,
      })

      const summary = await aiService.reviewCode(summaryPrompt, modelConfig)

      // 保存 AI 总结到数据库
      await prisma.reviewLog.update({
        where: { id: reviewLogId },
        data: { aiSummary: summary },
      })

      // 逐个文件进行审查，记录每个文件的 AI 回复
      let totalComments: ReviewComment[] = []
      const aiResponsesByFile: Record<string, string> = {} // 按文件存储 AI 回复

      for (const diff of relevantDiffs) {
        const filePath = diff.new_path
        console.log(`📄 [ReviewService] Reviewing file: ${filePath}`)

        // 生成该文件的 patch
        const patch = this.generatePatch(diff)

        // 构建系统提示词：根据 customPromptMode 决定是替换还是扩展
        // - "replace": 完全使用自定义提示词，忽略内置提示词
        // - "extend": 在内置提示词基础上追加自定义提示词（默认）
        let systemPrompt = SYSTEM_PROMPT
        if (repository.customPrompt) {
          const promptMode = (repository as any).customPromptMode || 'extend'
          if (promptMode === 'replace') {
            // 替换模式：完全使用自定义提示词
            systemPrompt = repository.customPrompt
            console.log(`📝 [ReviewService] Using REPLACE mode - custom prompt only`)
          } else {
            // 扩展模式：内置 + 自定义
            systemPrompt = `${SYSTEM_PROMPT}\n\n【仓库自定义要求】\n${repository.customPrompt}`
            console.log(`📝 [ReviewService] Using EXTEND mode - built-in + custom prompt`)
          }
        }

        const reviewPrompt = buildReviewPrompt({
          title: mr?.title || reviewLog.title,
          description: mr?.description || reviewLog.description || '',
          filename: filePath,
          diff: patch,
          summary: summary,
        })

        const aiResponse = await aiService.reviewCode(reviewPrompt, modelConfig, systemPrompt)

        // 保存该文件的 AI 原始回复
        aiResponsesByFile[filePath] = aiResponse

        // 打印 AI 原始响应，便于调试解析问题
        console.log(`\n🤖 [ReviewService] AI Response for ${filePath}:`)
        console.log('┌─────────────────────────────────────────────┐')
        aiResponse.split('\n').forEach(line => {
          console.log(`│ ${line}`)
        })
        console.log('└─────────────────────────────────────────────┘')

        const comments = aiService.parseReviewComments(aiResponse, filePath)

        // 如果没有解析出评论，也创建一条评论记录（包含 AI 的原始响应）
        if (comments.length === 0) {
          comments.push({
            filePath,
            lineNumber: 1,
            severity: 'suggestion' as const,
            content: aiResponse.trim(), // 直接使用 AI 的原始回复
          })
        }

        console.log(`💬 [ReviewService] Found ${comments.length} comments in ${filePath}`)
        totalComments.push(...comments)

        // 更新已审查文件数
        await prisma.reviewLog.update({
          where: { id: reviewLogId },
          data: { reviewedFiles: { increment: 1 } },
        })
      }

      // 统计问题数量
      const criticalIssues = totalComments.filter((c) => c.severity === 'critical').length
      const normalIssues = totalComments.filter((c) => c.severity === 'normal').length
      const suggestions = totalComments.filter((c) => c.severity === 'suggestion').length

      console.log(`📊 [ReviewService] Review complete:`)
      console.log(`   🔴 Critical: ${criticalIssues}`)
      console.log(`   ⚠️ Normal: ${normalIssues}`)
      console.log(`   💡 Suggestions: ${suggestions}`)
      console.log(`   📝 Total comments: ${totalComments.length}`)

      // 保存评论到数据库
      for (const comment of totalComments) {
        await prisma.reviewComment.create({
          data: {
            reviewLogId,
            filePath: comment.filePath,
            lineNumber: comment.lineNumber,
            lineRangeEnd: comment.lineRangeEnd,
            severity: comment.severity,
            content: comment.content,
            diffHunk: comment.diffHunk,
          },
        })
      }

      // 更新审查日志状态，并保存 AI 完整回复
      await prisma.reviewLog.update({
        where: { id: reviewLogId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          criticalIssues,
          normalIssues,
          suggestions,
          aiResponse: JSON.stringify(aiResponsesByFile), // 保存所有文件的 AI 回复
        },
      })

      // 自动发布评论到 GitLab
      await this.postCommentsToGitLab(reviewLogId, gitlabService)

      return {
        success: true,
        totalComments: totalComments.length,
        criticalIssues,
        normalIssues,
        suggestions,
      }
    } catch (error) {
      console.error('Review failed:', error)

      // 更新状态为失败
      await prisma.reviewLog.update({
        where: { id: reviewLogId },
        data: {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      })

      throw error
    }
  }

  /**
   * 将评论发布到 GitLab
   */
  async postCommentsToGitLab(reviewLogId: string, gitlabService: any) {
    const reviewLog = await prisma.reviewLog.findUnique({
      where: { id: reviewLogId },
      include: {
        repository: true,
        comments: {
          where: { isPosted: false },
        },
      },
    })

    if (!reviewLog) {
      throw new Error('Review log not found')
    }

    // Push 事件没有 MR，使用 Commit Comment 发布评论
    if (reviewLog.mergeRequestIid === 0) {
      console.log(`📝 [ReviewService] Push event - posting comments to commit: ${reviewLog.commitSha}`)
      await this.postCommentsToCommit(reviewLog, gitlabService)
      return
    }

    const mr = await gitlabService.getMergeRequest(
      reviewLog.repository.gitLabProjectId,
      reviewLog.mergeRequestIid
    )

    // 为每个评论创建行内评论
    for (const comment of reviewLog.comments) {
      try {
        // 简洁的评论格式：直接显示内容 + 来源信息
        const commentBody = `${comment.content}\n\n---\n<sub>🤖comment by code review copilot, written by yuguaa</sub>`

        // 构建 position 用于行内评论
        const position = {
          base_sha: mr.diff_refs.base_sha,
          head_sha: mr.diff_refs.head_sha,
          start_sha: mr.diff_refs.start_sha,
          old_path: comment.filePath,
          new_path: comment.filePath,
          position_type: 'text' as const,
          new_line: comment.lineNumber,
        }

        const result = await gitlabService.createMergeRequestComment(
          reviewLog.repository.gitLabProjectId,
          reviewLog.mergeRequestIid,
          commentBody,
          position
        )

        // 更新评论状态
        await prisma.reviewComment.update({
          where: { id: comment.id },
          data: {
            isPosted: true,
            gitlabCommentId: result.id?.toString(),
          },
        })

        console.log(`✅ Posted inline comment: ${comment.filePath}:${comment.lineNumber}`)
      } catch (error) {
        // 行内评论失败，尝试发布普通评论
        console.log(`⚠️ Inline comment failed for ${comment.filePath}:${comment.lineNumber}, trying general comment...`)
        
        try {
          // 简洁的评论格式：直接显示内容 + 来源信息
          const commentBody = `${comment.content}\n\n---\n<sub>🤖comment by code review copilot, written by yuguaa</sub>`

          const result = await gitlabService.createMergeRequestComment(
            reviewLog.repository.gitLabProjectId,
            reviewLog.mergeRequestIid,
            commentBody,
            undefined  // 普通评论
          )

          await prisma.reviewComment.update({
            where: { id: comment.id },
            data: {
              isPosted: true,
              gitlabCommentId: result.id?.toString(),
            },
          })

          console.log(`✅ Posted general comment for: ${comment.filePath}:${comment.lineNumber}`)
        } catch (fallbackError) {
          console.error(`❌ Failed to post comment for ${comment.filePath}:${comment.lineNumber}`)
        }
      }
    }
  }

  /**
   * 将评论发布到 GitLab Commit（用于 Push 事件）
   */
  async postCommentsToCommit(reviewLog: any, gitlabService: any) {
    const comments = reviewLog.comments

    if (!comments || comments.length === 0) {
      console.log(`📭 [ReviewService] No comments to post`)
      return
    }

    console.log(`📤 [ReviewService] Posting ${comments.length} comments to commit ${reviewLog.commitSha}`)

    // 为每个评论创建 Commit 行内评论
    for (const comment of comments) {
      try {
        // 简洁的评论格式：直接显示内容 + 来源信息
        const commentBody = `${comment.content}\n\n---\n<sub>🤖comment by code review copilot, written by yuguaa</sub>`

        // 尝试行内评论
        const result = await gitlabService.createCommitComment(
          reviewLog.repository.gitLabProjectId,
          reviewLog.commitSha,
          commentBody,
          {
            path: comment.filePath,
            line: comment.lineNumber,
            line_type: 'new',
          }
        )

        await prisma.reviewComment.update({
          where: { id: comment.id },
          data: {
            isPosted: true,
            gitlabCommentId: result.id?.toString(),
          },
        })

        console.log(`✅ Posted inline comment to commit: ${comment.filePath}:${comment.lineNumber}`)
      } catch (error) {
        // 行内评论失败，尝试普通评论
        console.log(`⚠️ Inline commit comment failed, trying general comment...`)
        
        try {
          // 简洁的评论格式：直接显示内容 + 来源信息
          const commentBody = `${comment.content}\n\n---\n<sub>🤖comment by code review copilot, written by yuguaa</sub>`

          const result = await gitlabService.createCommitComment(
            reviewLog.repository.gitLabProjectId,
            reviewLog.commitSha,
            commentBody,
            undefined  // 普通评论
          )

          await prisma.reviewComment.update({
            where: { id: comment.id },
            data: {
              isPosted: true,
              gitlabCommentId: result.id?.toString(),
            },
          })

          console.log(`✅ Posted general comment to commit`)
        } catch (fallbackError) {
          console.error(`❌ Failed to post comment to commit: ${comment.filePath}:${comment.lineNumber}`)
        }
      }
    }
  }

  /**
   * 生成 patch 格式
   */
  private generatePatch(diff: any): string {
    return `--- a/${diff.old_path}
+++ b/${diff.new_path}
${diff.diff}`
  }
}

export const reviewService = new ReviewService()
