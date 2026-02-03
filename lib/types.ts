/**
 * @file types.ts
 * @description 项目全局类型定义
 *
 * 包含 AI 服务、GitLab API、代码审查等相关的 TypeScript 类型定义。
 */

/** AI 服务提供商类型 */
export type AIProvider = 'openai' | 'claude' | 'custom'

/** 审查问题严重程度 */
export type ReviewSeverity = 'critical' | 'normal' | 'suggestion'

/** 审查状态 */
export type ReviewStatus = 'pending' | 'completed' | 'failed'

/** GitLab 项目信息 */
export interface GitLabProject {
  id: number
  name: string
  path: string
  path_with_namespace: string
  description: string | null
  default_branch: string
  web_url: string
}

/** GitLab 合并请求信息 */
export interface GitLabMergeRequest {
  id: number
  iid: number
  project_id: number
  title: string
  description: string | null
  source_branch: string
  target_branch: string
  author: {
    id: number
    username: string
    name: string
  }
  created_at: string
  updated_at: string
  merge_status: string
  diff_refs: {
    base_sha: string
    head_sha: string
    start_sha: string
  }
}

/** GitLab 文件变更信息 */
export interface GitLabDiff {
  diff: string
  new_path: string
  old_path: string
  new_file: boolean
  renamed_file: boolean
  deleted_file: boolean
}

/** GitLab 提交信息 */
export interface GitLabCommit {
  id: string
  short_id: string
  title: string
  message: string
  author_name: string
  author_email: string
  created_at: string
}

/** AI 模型配置 */
export interface AIModelConfig {
  id: string
  name: string
  provider: AIProvider
  modelId: string
  apiKey: string
  apiEndpoint?: string
  maxTokens?: number
  temperature?: number
  isActive: boolean
}

/** 代码审查评论 */
export interface ReviewComment {
  filePath: string
  lineNumber: number
  lineRangeEnd?: number
  severity: ReviewSeverity
  content: string
  diffHunk?: string
}

/** 代码审查输入参数 */
export interface ReviewInput {
  mergeRequest: GitLabMergeRequest
  diffs: GitLabDiff[]
  commit: GitLabCommit
  systemPrompt: string
  modelConfig: AIModelConfig
}

/** 代码审查输出结果 */
export interface ReviewOutput {
  comments: ReviewComment[]
}

/** 仪表盘统计数据 */
export interface DashboardStats {
  totalRepositories: number
  activeRepositories: number
  totalReviews: number
  reviewsThisWeek: number
  totalIssues: {
    critical: number
    normal: number
    suggestion: number
  }
  topRepositories: Array<{
    repositoryId: string
    repositoryName: string
    reviewCount: number
    issueCount: number
  }>
  topUsers: Array<{
    username: string
    reviewCount: number
    issueCount: number
  }>
}
