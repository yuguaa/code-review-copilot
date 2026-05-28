/**
 * @file types.ts
 * @description 代码审查工作流类型定义
 */

import type { ReviewLog } from "@prisma/client";
import type { GitLabDiff, AIModelConfig, ReviewComment, ReviewCommentSource, GitLabMergeRequest } from "@/lib/types";

/** 单个文件审查输入 */
export interface FileReviewInput {
  filePath: string;
  diff: GitLabDiff;
  patch: string;
}

/** 单个文件审查结果 */
export interface FileReviewResult {
  filePath: string;
  aiResponse: string;
  prompt: string;
  counts: {
    critical: number;
    normal: number;
    suggestion: number;
  };
  criticalItems: Array<{
    filePath: string | null;
    lineNumber: number;
    lineRangeEnd?: number | null;
    content: string;
  }>;
  reviewItems: Array<{
    filePath: string | null;
    lineNumber: number;
    lineRangeEnd?: number | null;
    severity: "critical" | "normal" | "suggestion";
    content: string;
    confidence?: number;
    reviewBotRunId?: string;
    sourceBotName?: string;
    sourceBotModel?: string;
    sourceBots?: ReviewCommentSource[];
  }>;
}

/** 审查统计汇总 */
export interface ReviewStatistics {
  critical: number;
  normal: number;
  suggestion: number;
  total: number;
}

type MergeRequestPosition = {
  base_sha: string;
  head_sha: string;
  start_sha: string;
  old_path: string;
  new_path: string;
  position_type: "text";
  new_line?: number;
  old_line?: number;
};

type GitLabDiscussionResult = {
  id: number | string;
  notes?: Array<{ id: number }>;
};

type GitLabCommentResult = {
  id?: number | string;
  note_id?: number;
  notes?: Array<{ id: number }>;
};

/** GitLab 服务实例 */
export interface GitLabServiceInstance {
  getMergeRequest: (projectId: number | string, mrIid: number) => Promise<GitLabMergeRequest>;
  getMergeRequestChanges: (projectId: number | string, mrIid: number) => Promise<GitLabDiff[]>;
  getCommitDiff: (projectId: number | string, commitSha: string) => Promise<GitLabDiff[]>;
  createMergeRequestComment: (projectId: number | string, mrIid: number, body: string, position?: MergeRequestPosition) => Promise<GitLabDiscussionResult>;
  updateMergeRequestComment: (projectId: number | string, mrIid: number, discussionId: string, noteId: number, body: string) => Promise<GitLabCommentResult>;
  getMergeRequestDiscussion: (projectId: number | string, mrIid: number, discussionId: string) => Promise<{ id: string; notes?: Array<{ id: number }> }>;
  getCommitComments: (projectId: number | string, commitSha: string) => Promise<Array<{ id?: number; note_id?: number; note?: string }>>;
  createCommitComment: (projectId: number | string, commitSha: string, note: string, options?: { path?: string; line?: number; line_type?: 'new' | 'old' }) => Promise<GitLabCommentResult>;
  updateCommitComment: (projectId: number | string, commitSha: string, noteId: number, body: string) => Promise<GitLabCommentResult>;
  compareCommits: (projectId: number | string, fromSha: string, toSha: string) => Promise<{ diffs: GitLabDiff[] }>;
  getProjectCommits: (projectId: number | string, params?: {
    since?: string;
    until?: string;
    ref_name?: string;
    author?: string;
    per_page?: number;
    max_pages?: number;
  }) => Promise<Array<{ id: string; short_id: string; title: string; message: string; author_name: string; author_email: string; created_at: string }>>;
}

/** 仓库配置信息 */
export interface RepositoryConfig {
  customPrompt?: string | null;
  customPromptMode?: "extend" | "replace";
}

/** 代码审查工作流状态 */
export interface ReviewState {
  reviewLogId: string;
  reviewBotRunId: string | null;
  gitlabService: GitLabServiceInstance | null;
  repositoryConfig: RepositoryConfig;
  modelConfig: AIModelConfig;
  mrInfo: GitLabMergeRequest | null;
  reviewLog: ReviewLog | null;
  diffs: GitLabDiff[];
  relevantDiffs: GitLabDiff[];
  reviewScope: "full" | "incremental";
  incrementalBaseSha: string | null;
  summary: string;
  memorySnapshotId: string | null;
  architectureSummary: string;
  agentContextSummary: string;
  agentPlan: Record<string, unknown>;
  agentTraceId: string | null;
  currentFileIndex: number;
  currentFile: FileReviewInput | null;
  fileResults: FileReviewResult[];
  statistics: ReviewStatistics;
  criticalComments: ReviewComment[];
  reviewComments: ReviewComment[];
  aiResponsesByFile: Record<string, string>;
  reviewPromptsByFile: Record<string, string>;
  completed: boolean;
  error: string | null;
}

export function createInitialReviewState(input: Partial<ReviewState>): ReviewState {
  return {
    reviewLogId: "",
    reviewBotRunId: null,
    gitlabService: null,
    repositoryConfig: {},
    modelConfig: {
      id: "default",
      name: "Default",
      provider: "openai",
      modelId: "gpt-4o",
      apiKey: "",
      isActive: true,
    },
    mrInfo: null,
    reviewLog: null,
    diffs: [],
    relevantDiffs: [],
    reviewScope: "full",
    incrementalBaseSha: null,
    summary: "",
    memorySnapshotId: null,
    architectureSummary: "",
    agentContextSummary: "",
    agentPlan: {},
    agentTraceId: null,
    currentFileIndex: 0,
    currentFile: null,
    fileResults: [],
    statistics: { critical: 0, normal: 0, suggestion: 0, total: 0 },
    criticalComments: [],
    reviewComments: [],
    aiResponsesByFile: {},
    reviewPromptsByFile: {},
    completed: false,
    error: null,
    ...input,
  };
}
