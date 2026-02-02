export type AIProvider = 'openai' | 'claude' | 'custom'

export type ReviewSeverity = 'critical' | 'normal' | 'suggestion'

export type ReviewStatus = 'pending' | 'completed' | 'failed'

export interface GitLabProject {
  id: number
  name: string
  path: string
  path_with_namespace: string
  description: string | null
  default_branch: string
  web_url: string
}

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

export interface GitLabDiff {
  diff: string
  new_path: string
  old_path: string
  new_file: boolean
  renamed_file: boolean
  deleted_file: boolean
}

export interface GitLabCommit {
  id: string
  short_id: string
  title: string
  message: string
  author_name: string
  author_email: string
  created_at: string
}

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

export interface ReviewComment {
  filePath: string
  lineNumber: number
  lineRangeEnd?: number
  severity: ReviewSeverity
  content: string
  diffHunk?: string
}

export interface ReviewInput {
  mergeRequest: GitLabMergeRequest
  diffs: GitLabDiff[]
  commit: GitLabCommit
  systemPrompt: string
  modelConfig: AIModelConfig
}

export interface ReviewOutput {
  comments: ReviewComment[]
}

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
