/**
 * GitLab API v4 相关类型（从旧版 lib/types.ts 提取的 GitLab 子集）。
 */

export interface GitLabProject {
  id: number;
  name: string;
  path: string;
  path_with_namespace: string;
  description: string | null;
  default_branch: string;
  web_url: string;
}

export interface GitLabMergeRequest {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string | null;
  source_branch: string;
  target_branch: string;
  author: {
    id: number;
    username: string;
    name: string;
  };
  created_at: string;
  updated_at: string;
  merge_status: string;
  diff_refs: {
    base_sha: string;
    head_sha: string;
    start_sha: string;
  };
}

export interface GitLabDiff {
  diff: string;
  new_path: string;
  old_path: string;
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
}

export interface GitLabCompareResult {
  commit: {
    id: string;
    short_id: string;
    title: string;
  };
  commits: GitLabCommit[];
  diffs: GitLabDiff[];
  compare_same_ref?: boolean;
  compare_timeout?: boolean;
}

export interface GitLabCommitComment {
  id?: number;
  note_id?: number;
  note?: string;
  author?: {
    id: number;
    name: string;
    username: string;
  };
}

export interface GitLabCommit {
  id: string;
  short_id: string;
  title: string;
  message: string;
  author_name: string;
  author_email: string;
  created_at: string;
}

export interface GitLabRepositoryTreeItem {
  id: string;
  name: string;
  type: 'tree' | 'blob';
  path: string;
  mode: string;
}

export interface GitLabBranch {
  name: string;
  commit: GitLabCommit;
}
