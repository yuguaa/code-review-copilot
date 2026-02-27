/**
 * @file types.ts
 * @description LangGraph 代码审查状态图类型定义
 */

import { Annotation } from "@langchain/langgraph";
import type { ReviewLog } from "@prisma/client";
import type { GitLabDiff, AIModelConfig, ReviewComment, GitLabMergeRequest } from "@/lib/types";

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
  }>;
}

/** 审查统计汇总 */
export interface ReviewStatistics {
  critical: number;
  normal: number;
  suggestion: number;
  total: number;
}

/** GitLab 服务实例 */
export interface GitLabServiceInstance {
  getMergeRequest: (projectId: number | string, mrIid: number) => Promise<GitLabMergeRequest>;
  getMergeRequestChanges: (projectId: number | string, mrIid: number) => Promise<GitLabDiff[]>;
  getCommitDiff: (projectId: number | string, commitSha: string) => Promise<GitLabDiff[]>;
  createMergeRequestComment: (projectId: number | string, mrIid: number, body: string, position?: any) => Promise<any>;
  updateMergeRequestComment: (projectId: number | string, mrIid: number, discussionId: string, noteId: number, body: string) => Promise<any>;
  createCommitComment: (projectId: number | string, commitSha: string, note: string, options?: { path?: string; line?: number; line_type?: 'new' | 'old' }) => Promise<any>;
  updateCommitComment: (projectId: number | string, commitSha: string, noteId: number, body: string) => Promise<any>;
  compareCommits: (projectId: number | string, fromSha: string, toSha: string) => Promise<{ diffs: GitLabDiff[] }>;
}

/** 仓库配置信息 */
export interface RepositoryConfig {
  customPrompt?: string | null;
  customPromptMode?: "extend" | "replace";
}

/**
 * LangGraph 状态定义
 * 使用 LangGraph 的 Annotation API 定义状态
 */
export const ReviewStateAnnotation = Annotation.Root({
  // 输入参数
  reviewLogId: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),

  // GitLab 服务实例（运行时传入，不序列化）
  gitlabService: Annotation<GitLabServiceInstance | null>({
    reducer: (_, y) => y,
    default: () => null,
  }),

  // 仓库配置
  repositoryConfig: Annotation<RepositoryConfig>({
    reducer: (_, y) => y,
    default: () => ({}),
  }),

  // AI 模型配置
  modelConfig: Annotation<AIModelConfig>({
    reducer: (_, y) => y,
    default: () => ({
      id: "default",
      name: "Default",
      provider: "openai",
      modelId: "gpt-4o",
      apiKey: "",
      isActive: true,
    }),
  }),

  // MR/Commit 信息
  mrInfo: Annotation<GitLabMergeRequest | null>({
    reducer: (_, y) => y,
    default: () => null,
  }),
  reviewLog: Annotation<ReviewLog | null>({
    reducer: (_, y) => y,
    default: () => null,
  }),

  // 获取的 diff 数据
  diffs: Annotation<GitLabDiff[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),
  relevantDiffs: Annotation<GitLabDiff[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),

  // 审查范围信息
  reviewScope: Annotation<"full" | "incremental">({
    reducer: (_, y) => y,
    default: () => "full",
  }),
  incrementalBaseSha: Annotation<string | null>({
    reducer: (_, y) => y,
    default: () => null,
  }),

  // 变更摘要
  summary: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),

  // 循环状态：当前文件索引
  currentFileIndex: Annotation<number>({
    reducer: (x, y) => y ?? x,  // 如果新值是 undefined，保持旧值
    default: () => 0,
  }),

  // 当前正在处理的文件
  currentFile: Annotation<FileReviewInput | null>({
    reducer: (_, y) => y,
    default: () => null,
  }),

  // 单文件审查结果
  fileResults: Annotation<FileReviewResult[]>({
    reducer: (x, y) => [...x, ...y],
    default: () => [],
  }),

  // 汇总统计
  statistics: Annotation<ReviewStatistics>({
    reducer: (_, y) => y,
    default: () => ({ critical: 0, normal: 0, suggestion: 0, total: 0 }),
  }),

  // 严重问题列表
  criticalComments:Annotation<ReviewComment[]>({
    reducer: (x, y) => [...x, ...y],
    default: () => [],
  }),

  // 全量问题列表（严重/一般/建议）
  reviewComments:Annotation<ReviewComment[]>({
    reducer: (x, y) => [...x, ...y],
    default: () => [],
  }),

  // AI 响应记录（按文件）
  aiResponsesByFile: Annotation<Record<string, string>>({
    reducer: (x, y) => ({ ...x, ...y }),
    default: () => ({}),
  }),

  // Prompt 记录（按文件）
  reviewPromptsByFile: Annotation<Record<string, string>>({
    reducer: (x, y) => ({ ...x, ...y }),
    default: () => ({}),
  }),

  // 是否完成
  completed: Annotation<boolean>({
    reducer: (_, y) => y,
    default: () => false,
  }),

  // 错误信息
  error: Annotation<string | null>({
    reducer: (_, y) => y,
    default: () => null,
  }),
});

/** 状态类型导出 */
export type ReviewState = typeof ReviewStateAnnotation.State;
