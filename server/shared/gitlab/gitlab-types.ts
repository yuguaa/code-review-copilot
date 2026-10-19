export type GitLabProject = {
  id: number;
  name: string;
  path: string;
  path_with_namespace: string;
  description: string | null;
  default_branch: string | null;
  web_url: string;
};

export type GitLabMergeRequest = {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string | null;
  source_branch: string;
  target_branch: string;
  author: { id: number; username: string; name: string };
  created_at: string;
  updated_at: string;
  state: string;
  web_url: string;
  sha: string;
  diff_refs: { base_sha: string; start_sha: string; head_sha: string } | null;
};

export type GitLabMergeRequestVersion = {
  id: number;
  base_commit_sha: string;
  start_commit_sha: string;
  head_commit_sha: string;
  created_at?: string;
  state?: string;
  real_size?: string;
};

export type GitLabDiff = {
  diff: string;
  new_path: string;
  old_path: string;
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
  collapsed?: boolean;
  too_large?: boolean;
  generated_file?: boolean;
};

export type GitLabCommit = {
  id: string;
  short_id: string;
  title: string;
  message: string;
  parent_ids: string[];
  author_name: string;
  author_email: string;
  created_at: string;
  web_url: string;
};

export type GitLabCompareResult = {
  commit: GitLabCommit;
  commits: GitLabCommit[];
  diffs: GitLabDiff[];
  compare_same_ref?: boolean;
  compare_timeout?: boolean;
};

export type GitLabCommitComment = {
  id: number;
  note_id: number;
  discussion_id: string;
  note: string;
};

export type GitLabRepositoryTreeItem = { id: string; name: string; type: "tree" | "blob"; path: string; mode: string };
export type GitLabBranch = { name: string; commit: GitLabCommit };
