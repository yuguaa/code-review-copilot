import type { AxiosError } from 'axios';

type Logger = {
  error: (message: string, ...values: unknown[]) => void;
};

export type GitLabApiError = AxiosError<{ message?: string; error?: string }>;

export type MergeRequestPosition = {
  base_sha: string;
  head_sha: string;
  start_sha: string;
  old_path: string;
  new_path: string;
  position_type: 'text';
  new_line?: number;
  old_line?: number;
};

export type MergeRequestCommentPayload = {
  body: string;
  position?: {
    base_sha: string;
    head_sha: string;
    start_sha: string;
    old_path: string;
    new_path: string;
    position_type: 'text';
    new_line?: number;
    old_line?: number;
  };
};

export type CommitCommentPayload = {
  note: string;
  path?: string;
  line?: number;
  line_type?: 'new' | 'old';
};

export type GitLabDiscussionResult = {
  id: number | string;
  notes?: Array<{ id: number }>;
};

export type GitLabCommentResult = {
  id?: number | string;
  note_id?: number;
  notes?: Array<{ id: number }>;
};

export type GitLabWebhookResult = {
  id: number;
  url: string;
};

export type CommitCommentOptions = {
  path?: string;
  line?: number;
  line_type?: 'new' | 'old';
};

export function buildMergeRequestCommentPayload(comment: string, position?: MergeRequestPosition): MergeRequestCommentPayload {
  const data: MergeRequestCommentPayload = { body: comment };
  if (!position) return data;

  data.position = {
    base_sha: position.base_sha,
    head_sha: position.head_sha,
    start_sha: position.start_sha,
    old_path: position.old_path,
    new_path: position.new_path,
    position_type: position.position_type,
  };
  if (position.new_line) data.position.new_line = position.new_line;
  if (position.old_line) data.position.old_line = position.old_line;
  return data;
}

export function formatCommitCommentBody(comment: string, options?: CommitCommentOptions): string {
  if (!options?.path) return comment;
  return `**文件**: \`${options.path}\`${options.line ? ` (行 ${options.line})` : ''}\n\n${comment}`;
}

export function buildCommitCommentPayload(
  comment: string,
  options?: CommitCommentOptions,
  includeLine = true,
): CommitCommentPayload {
  const data: CommitCommentPayload = { note: formatCommitCommentBody(comment, options) };

  if (includeLine && options?.path && options?.line) {
    data.path = options.path;
    data.line = options.line;
    data.line_type = options.line_type || 'new';
  }

  return data;
}

export function logGitLabApiError(log: Logger, message: string, error: unknown): GitLabApiError {
  const apiError = error as GitLabApiError;
  if (apiError.response?.data) {
    log.error('GitLab API error response:', JSON.stringify(apiError.response.data, null, 2));
  }
  log.error(message, error);
  return apiError;
}
