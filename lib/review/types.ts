/**
 * @file types.ts
 * @description 代码审查状态类型定义
 */

import type { Prisma } from "@prisma/client";
import type { GitLabDiff, ReviewComment, ReviewCommentSource, GitLabMergeRequest } from "@/lib/types";

export type ReviewLogWithRepository = Prisma.ReviewLogGetPayload<{
  include: {
    repository: {
      include: {
        gitLabAccount: true;
      };
    };
  };
}>;

/** 单个文件审查输入 */
export interface FileReviewInput {
  filePath: string;
  diff: GitLabDiff;
  patch: string;
}

/** 单个文件审查结果 */
export interface FileReviewResult {
  filePath: string;
  piRawOutput: string;
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
    piReviewRunId?: string;
    sourceProfileName?: string;
    sourceProfileModel?: string;
    sourceProfiles?: ReviewCommentSource[];
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
}

/** 代码审查执行状态 */
export interface ReviewState {
  reviewLogId: string;
  piReviewRunId: string | null;
  gitlabService: GitLabServiceInstance | null;
  mrInfo: GitLabMergeRequest | null;
  reviewLog: ReviewLogWithRepository | null;
  diffs: GitLabDiff[];
  relevantDiffs: GitLabDiff[];
  reviewScope: "full" | "incremental";
  incrementalBaseSha: string | null;
  summary: string;
  currentFileIndex: number;
  currentFile: FileReviewInput | null;
  fileResults: FileReviewResult[];
  statistics: ReviewStatistics;
  criticalComments: ReviewComment[];
  reviewComments: ReviewComment[];
  piRawOutputsByFile: Record<string, string>;
  piPromptsByFile: Record<string, string>;
  completed: boolean;
  error: string | null;
}

export function createInitialReviewState(input: Partial<ReviewState>): ReviewState {
  return {
    reviewLogId: "",
    piReviewRunId: null,
    gitlabService: null,
    mrInfo: null,
    reviewLog: null,
    diffs: [],
    relevantDiffs: [],
    reviewScope: "full",
    incrementalBaseSha: null,
    summary: "",
    currentFileIndex: 0,
    currentFile: null,
    fileResults: [],
    statistics: { critical: 0, normal: 0, suggestion: 0, total: 0 },
    criticalComments: [],
    reviewComments: [],
    piRawOutputsByFile: {},
    piPromptsByFile: {},
    completed: false,
    error: null,
    ...input,
  };
}
