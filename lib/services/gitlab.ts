import axios, { AxiosInstance } from 'axios'
import type { GitLabProject, GitLabMergeRequest, GitLabDiff, GitLabCommit } from '@/lib/types'

export class GitLabService {
  private client: AxiosInstance

  constructor(baseUrl: string, accessToken: string) {
    const normalizedBaseUrl = GitLabService.normalizeApiBaseUrl(baseUrl) // 规范化 GitLab API 基础地址
    this.client = axios.create({ // 创建 Axios 客户端实例
      baseURL: normalizedBaseUrl, // 使用规范化后的 API 基础地址
      headers: { // 设置请求头
        'PRIVATE-TOKEN': accessToken, // 携带 GitLab 私有访问令牌
      }, // 结束请求头配置
    }) // 结束 Axios 实例创建
  }

  private static normalizeApiBaseUrl(baseUrl: string): string { // 规范化 GitLab API 基础地址
    const trimmedBaseUrl = baseUrl.trim() // 去除首尾空格
    const parsedUrl = new URL(trimmedBaseUrl) // 解析为 URL 对象
    const origin = parsedUrl.origin // 提取协议与域名
    const hasApiPath = parsedUrl.pathname.includes('/api/v4') // 判断是否包含 API 前缀
    if (hasApiPath) { // 当原始地址已包含 /api/v4
      return `${origin}/api/v4` // 统一返回标准 API 根路径
    } // 结束包含检查
    return `${origin}/api/v4` // 默认拼接 API v4 根路径
  } // 结束 normalizeApiBaseUrl

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
   * 获取 Merge Request 的单个 commit
   * 只获取最新一次提交的 staged diff
   */
  async getMergeRequestCommits(projectId: number | string, mergeRequestIid: number): Promise<GitLabCommit[]> {
    try {
      const response = await this.client.get(
        `/projects/${projectId}/merge_requests/${mergeRequestIid}/commits`,
        {
          params: {
            per_page: 1, // 只获取最新的 commit
          },
        }
      )
      return response.data
    } catch (error) {
      console.error('Failed to fetch merge request commits:', error)
      throw new Error('Failed to fetch merge request commits from GitLab')
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
   * 在 Merge Request 中创建评论
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
      new_line: number
    }
  ): Promise<any> {
    try {
      const data: any = {
        body: comment,
      }

      if (position) {
        data.position = position
      }

      const response = await this.client.post(
        `/projects/${projectId}/merge_requests/${mergeRequestIid}/discussions`,
        data
      )
      return response.data
    } catch (error) {
      console.error('Failed to create merge request comment:', error)
      throw new Error('Failed to create comment on GitLab')
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

export function createGitLabService(baseUrl: string, accessToken: string): GitLabService {
  return new GitLabService(baseUrl, accessToken)
}
