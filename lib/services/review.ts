import { prisma } from '@/lib/prisma'
import { createGitLabService } from './gitlab'
import { aiService } from './ai'
import { prompts } from '@/lib/prompts'
import type { AIModelConfig, ReviewComment } from '@/lib/types'

export class ReviewService {
  /**
   * 执行代码审查
   */
  async performReview(reviewLogId: string) {
    const reviewLog = await prisma.reviewLog.findUnique({
      where: { id: reviewLogId },
      include: {
        repository: {
          include: {
            gitLabAccount: true,
          },
        },
        branchConfig: {
          include: {
            aiModel: true,
          },
        },
      },
    })

    if (!reviewLog) {
      throw new Error('Review log not found')
    }

    try {
      // 更新状态为进行中
      await prisma.reviewLog.update({
        where: { id: reviewLogId },
        data: { status: 'pending' },
      })

      // 创建 GitLab 服务
      const gitlabService = createGitLabService(
        reviewLog.repository.gitLabAccount.url,
        reviewLog.repository.gitLabAccount.accessToken
      )

      // 获取 MR 详情
      const mr = await gitlabService.getMergeRequest(
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
      const diffs = await gitlabService.getCommitDiff(
        reviewLog.repository.gitLabProjectId,
        latestCommit.id
      )

      // 过滤掉删除的文件
      const relevantDiffs = diffs.filter((diff) => !diff.deleted_file)

      // 更新文件总数
      await prisma.reviewLog.update({
        where: { id: reviewLogId },
        data: { totalFiles: relevantDiffs.length },
      })

      // 准备 AI 模型配置
      const modelConfig: AIModelConfig = {
        id: reviewLog.branchConfig.aiModel.id,
        name: reviewLog.branchConfig.aiModel.name,
        provider: reviewLog.branchConfig.aiModel.provider as any,
        modelId: reviewLog.branchConfig.aiModel.modelId,
        apiKey: reviewLog.branchConfig.aiModel.apiKey,
        apiEndpoint: reviewLog.branchConfig.aiModel.apiEndpoint || undefined,
        maxTokens: reviewLog.branchConfig.aiModel.maxTokens || undefined,
        temperature: reviewLog.branchConfig.aiModel.temperature || undefined,
        isActive: reviewLog.branchConfig.aiModel.isActive,
      }

      // 首先总结所有变更
      const allDiffsText = diffs.map((d) => d.diff).join('\n')
      const summaryPrompt = prompts.renderSummarizeChanges({
        title: mr.title,
        description: mr.description || '',
        file_diff: allDiffsText,
        filename: '',
        patches: '',
        short_summary: '',
      })

      const summary = await aiService.reviewCode(summaryPrompt, modelConfig)

      // 逐个文件进行审查
      let totalComments: ReviewComment[] = []

      for (const diff of relevantDiffs) {
        const filePath = diff.new_path

        // 生成该文件的 patch
        const patch = this.generatePatch(diff)

        const reviewPrompt = prompts.renderReviewFileDiff({
          title: mr.title,
          description: mr.description || '',
          file_diff: diff.diff,
          filename: filePath,
          patches: patch,
          short_summary: summary,
        })

        const aiResponse = await aiService.reviewCode(reviewPrompt, modelConfig)
        const comments = aiService.parseReviewComments(aiResponse, filePath)

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

      // 更新审查日志状态
      await prisma.reviewLog.update({
        where: { id: reviewLogId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          criticalIssues,
          normalIssues,
          suggestions,
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
        comments: {
          where: { isPosted: false },
        },
      },
    })

    if (!reviewLog) {
      throw new Error('Review log not found')
    }

    const mr = await gitlabService.getMergeRequest(
      reviewLog.repositoryId,
      reviewLog.mergeRequestIid
    )

    for (const comment of reviewLog.comments) {
      try {
        // 构建 GitLab 位置信息
        const position = {
          base_sha: mr.diff_refs.base_sha,
          head_sha: mr.diff_refs.head_sha,
          start_sha: mr.diff_refs.start_sha,
          old_path: comment.filePath,
          new_path: comment.filePath,
          position_type: 'text' as const,
          new_line: comment.lineNumber,
        }

        // 添加严重级别标签
        const severityLabel = {
          critical: '🔴 严重',
          normal: '⚠️ 一般',
          suggestion: '💡 建议',
        }[comment.severity]

        const commentBody = `${severityLabel}\n\n${comment.content}`

        const result = await gitlabService.createMergeRequestComment(
          reviewLog.repositoryId,
          reviewLog.mergeRequestIid,
          commentBody,
          position
        )

        // 更新评论状态
        await prisma.reviewComment.update({
          where: { id: comment.id },
          data: {
            isPosted: true,
            gitlabCommentId: result.id,
          },
        })
      } catch (error) {
        console.error(`Failed to post comment ${comment.id} to GitLab:`, error)
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
