/**
 * GitLab 服务模块
 * 
 * 封装 GitLab API v4 的所有交互逻辑，包括：
 * - 项目/仓库管理
 * - Merge Request 操作
 * - Commit 和 Diff 获取
 * - 评论发布
 */

import axios, { AxiosInstance } from 'axios'
import type { GitLabProject, GitLabMergeRequest, GitLabDiff, GitLabCommit, GitLabCompareResult } from '@/lib/types'

/**
 * GitLab 服务类
 */
export class GitLabService {
  private client: AxiosInstance

  constructor(baseUrl: string, accessToken: string) {
    const normalizedBaseUrl = GitLabService.normalizeApiBaseUrl(baseUrl)
    this.client = axios.create({
      baseURL: normalizedBaseUrl,
      headers: { 'PRIVATE-TOKEN': accessToken },
    })
  }

  /**
   * 规范化 GitLab API 基础地址
   */
  private static normalizeApiBaseUrl(baseUrl: string): string {
    const trimmedBaseUrl = baseUrl.trim()
    const parsedUrl = new URL(trimmedBaseUrl)
    const origin = parsedUrl.origin
    return `${origin}/api/v4`
  }

  /**
   * 获取所有项目（仓库）
   */
  async getProjects(search?: string, params?: { membership?: boolean; owned?: boolean; per_page?: number }): Promise<GitLabProject[]> {
    try {
      const response = await this.client.get('/projects', {
        params: {
          membership: true,
          per_page: 100,
          search: search || undefined,
          ...params,
        },
      })
      return response.data
    } catch (error) {
      console.error('Failed to fetch GitLab projects:', error)
      throw new Error('Failed to fetch projects from GitLab')
    }
  }

  /**
   * 获取单个项目详情
   */
  async getProject(projectId: number | string): Promise<GitLabProject> {
    try {
      const response = await this.client.get(`/projects/${projectId}`)
      return response.data
    } catch (error) {
      console.error('Failed to fetch GitLab project:', error)
      throw new Error('Failed to fetch project from GitLab')
    }
  }

  /**
   * 获取项目的 Merge Requests
   */
  async getMergeRequests(projectId: number | string, params?: {
    state?: 'opened' | 'closed' | 'merged'
    order_by?: 'created_at' | 'updated_at'
    sort?: 'asc' | 'desc'
    per_page?: number
  }): Promise<GitLabMergeRequest[]> {
    try {
      const response = await this.client.get(`/projects/${projectId}/merge_requests`, {
        params: {
          state: 'opened',
          order_by: 'created_at',
          sort: 'desc',
          per_page: 100,
          ...params,
        },
      })
      return response.data
    } catch (error) {
      console.error('Failed to fetch merge requests:', error)
      throw new Error('Failed to fetch merge requests from GitLab')
    }
  }

  /**
   * 获取单个 Merge Request 详情
   */
  async getMergeRequest(projectId: number | string, mergeRequestIid: number): Promise<GitLabMergeRequest> {
    try {
      const response = await this.client.get(
        `/projects/${projectId}/merge_requests/${mergeRequestIid}`
      )
      return response.data
    } catch (error) {
      console.error('Failed to fetch merge request:', error)
      throw new Error('Failed to fetch merge request from GitLab')
    }
  }

  /**
   * 获取 Merge Request 的 diffs
   */
  async getMergeRequestDiffs(projectId: number | string, mergeRequestIid: number): Promise<GitLabDiff[]> {
    try {
      const response = await this.client.get(
        `/projects/${projectId}/merge_requests/${mergeRequestIid}/diffs`
      )
      return response.data
    } catch (error) {
      console.error('Failed to fetch merge request diffs:', error)
      throw new Error('Failed to fetch merge request diffs from GitLab')
    }
  }

  /**
   * 获取 MR 的所有 Commits
   * @param per_page 每页返回的 commit 数量，默认 100
   */
  async getMergeRequestCommits(projectId: number | string, mergeRequestIid: number, per_page: number = 100): Promise<GitLabCommit[]> {
    try {
      const response = await this.client.get(
        `/projects/${projectId}/merge_requests/${mergeRequestIid}/commits`,
        { params: { per_page } }
      )
      return response.data
    } catch (error) {
      console.error('Failed to fetch merge request commits:', error)
      throw new Error('Failed to fetch merge request commits from GitLab')
    }
  }

  /**
   * 获取 MR 的所有变更（使用 version API 获取完整 diff）
   * 这是获取 MR 所有变更的正确方法，不会遗漏任何 commit 的变更
   */
  async getMergeRequestChanges(projectId: number | string, mergeRequestIid: number): Promise<GitLabDiff[]> {
    try {
      const response = await this.client.get(
        `/projects/${projectId}/merge_requests/${mergeRequestIid}/changes`
      )
      return response.data.changes || response.data
    } catch (error) {
      console.error('Failed to fetch merge request changes:', error)
      throw new Error('Failed to fetch merge request changes from GitLab')
    }
  }

  /**
   * 获取单个 commit 的 diff
   */
  async getCommitDiff(projectId: number | string, commitSha: string): Promise<GitLabDiff[]> {
    try {
      const response = await this.client.get(
        `/projects/${projectId}/repository/commits/${commitSha}/diff`
      )
      return response.data
    } catch (error) {
      console.error('Failed to fetch commit diff:', error)
      throw new Error('Failed to fetch commit diff from GitLab')
    }
  }

  /**
   * 获取两个提交之间的增量 diff
   */
  async compareCommits(
    projectId: number | string,
    fromSha: string,
    toSha: string
  ): Promise<GitLabCompareResult> {
    try {
      const response = await this.client.get(
        `/projects/${projectId}/repository/compare`,
        {
          params: {
            from: fromSha,
            to: toSha,
            straight: true,
          },
        }
      )
      return response.data
    } catch (error) {
      console.error('Failed to compare commits:', error)
      throw new Error('Failed to compare commits from GitLab')
    }
  }

  /**
   * 在 MR 中创建评论（支持行内评论）
   */
  async createMergeRequestComment(
    projectId: number | string,
    mergeRequestIid: number,
    comment: string,
    position?: {
      base_sha: string
      head_sha: string
      start_sha: string
      old_path: string
      new_path: string
      position_type: 'text'
      new_line?: number
      old_line?: number
    }
  ): Promise<any> {
    try {
      const data: any = { body: comment }

      if (position) {
        data.position = {
          base_sha: position.base_sha,
          head_sha: position.head_sha,
          start_sha: position.start_sha,
          old_path: position.old_path,
          new_path: position.new_path,
          position_type: position.position_type,
        }
        if (position.new_line) data.position.new_line = position.new_line
        if (position.old_line) data.position.old_line = position.old_line
      }

      const response = await this.client.post(
        `/projects/${projectId}/merge_requests/${mergeRequestIid}/discussions`,
        data
      )
      return response.data
    } catch (error: any) {
      if (error.response?.data) {
        console.error('GitLab API error response:', JSON.stringify(error.response.data, null, 2))
      }
      throw error
    }
  }

  /**
   * 更新 MR 中的 Discussion 评论
   * @param projectId - 项目 ID
   * @param mergeRequestIid - MR IID
   * @param discussionId - Discussion ID
   * @param noteId - Note ID（评论的具体 ID）
   * @param newBody - 新的评论内容
   */
  async updateMergeRequestComment(
    projectId: number | string,
    mergeRequestIid: number,
    discussionId: string,
    noteId: number,
    newBody: string
  ): Promise<any> {
    try {
      // GitLab API: PUT /projects/:id/merge_requests/:merge_request_iid/discussions/:discussion_id/notes/:note_id
      const response = await this.client.put(
        `/projects/${projectId}/merge_requests/${mergeRequestIid}/discussions/${discussionId}/notes/${noteId}`,
        { body: newBody }
      )
      return response.data
    } catch (error: any) {
      if (error.response?.data) {
        console.error('GitLab API error response:', JSON.stringify(error.response.data, null, 2))
      }
      console.error('Failed to update MR comment:', error)
      throw new Error('Failed to update comment on GitLab MR')
    }
  }

  /**
   * 更新 Commit 上的评论
   * @param projectId - 项目 ID
   * @param commitSha - Commit SHA
   * @param noteId - Note ID（评论的具体 ID）
   * @param newBody - 新的评论内容
   */
  async updateCommitComment(
    projectId: number | string,
    commitSha: string,
    noteId: number,
    newBody: string
  ): Promise<any> {
    try {
      // GitLab API: PUT /projects/:id/repository/commits/:sha/comments/:note_id
      // 注意：GitLab Commit comments 的更新 API 可能不支持，尝试使用通用 notes API
      const response = await this.client.put(
        `/projects/${projectId}/repository/commits/${commitSha}/comments/${noteId}`,
        { note: newBody }
      )
      return response.data
    } catch (error: any) {
      // 如果更新失败，回退到创建新评论（某些 GitLab 版本不支持更新 commit comments）
      console.warn('Failed to update commit comment, falling back to create new comment')
      if (error.response?.data) {
        console.error('GitLab API error response:', JSON.stringify(error.response.data, null, 2))
      }
      // 回退：创建新评论
      return await this.createCommitComment(projectId, commitSha, newBody)
    }
  }

  /**
   * 创建项目 webhook
   */
  async createProjectWebhook(
    projectId: number | string,
    webhookUrl: string,
    webhookSecret?: string
  ): Promise<any> {
    try {
      const response = await this.client.post(`/projects/${projectId}/hooks`, {
        url: webhookUrl,
        merge_requests_events: true,
        push_events: false,
        token: webhookSecret,
      })
      return response.data
    } catch (error) {
      console.error('Failed to create webhook:', error)
      throw new Error('Failed to create webhook on GitLab')
    }
  }

  /**
   * 在 Commit 上创建评论（用于 Push 事件）
   */
  async createCommitComment(
    projectId: number | string,
    commitSha: string,
    comment: string,
    options?: {
      path?: string
      line?: number
      line_type?: 'new' | 'old'
    }
  ): Promise<any> {
    try {
      let fullComment = comment
      if (options?.path) {
        fullComment = `**文件**: \`${options.path}\`${options.line ? ` (行 ${options.line})` : ''}\n\n${comment}`
      }

      const data: any = { note: fullComment }

      if (options?.path && options?.line) {
        data.path = options.path
        data.line = options.line
        data.line_type = options.line_type || 'new'
      }

      console.log('Creating commit comment with data:', JSON.stringify(data, null, 2))

      const response = await this.client.post(
        `/projects/${projectId}/repository/commits/${commitSha}/comments`,
        data
      )
      return response.data
    } catch (error: any) {
      // 如果带行号失败，重试不带行号
      if (error.response?.status === 400 && options?.path) {
        console.log('Retry without line info...')
        try {
          let fullComment = comment
          if (options?.path) {
            fullComment = `**文件**: \`${options.path}\`${options.line ? ` (行 ${options.line})` : ''}\n\n${comment}`
          }
          const response = await this.client.post(
            `/projects/${projectId}/repository/commits/${commitSha}/comments`,
            { note: fullComment }
          )
          return response.data
        } catch (retryError) {
          console.error('Retry also failed:', retryError)
        }
      }

      if (error.response?.data) {
        console.error('GitLab API error response:', JSON.stringify(error.response.data, null, 2))
      }
      console.error('Failed to create commit comment:', error)
      throw new Error('Failed to create comment on GitLab commit')
    }
  }

  /**
   * 测试 GitLab 连接
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.client.get('/user')
      return !!response.data
    } catch (error) {
      console.error('GitLab connection test failed:', error)
      return false
    }
  }
}

/**
 * 创建 GitLab 服务实例
 */
export function createGitLabService(baseUrl: string, accessToken: string): GitLabService {
  return new GitLabService(baseUrl, accessToken)
}
