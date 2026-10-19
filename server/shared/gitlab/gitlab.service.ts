import axios from "axios";

import { buildCommitCommentPayload, buildMergeRequestCommentPayload, gitLabDiscussion, parseCommitDiscussion } from "./gitlab-comments";
import { fetchGitLabPages } from "./gitlab-pagination";

import type { AxiosInstance } from "axios";
import type { CommitCommentOptions, GitLabDiscussionResult, GitLabWebhookResult, MergeRequestPosition } from "./gitlab-comments";
import type { GitLabBranch, GitLabCommit, GitLabCommitComment, GitLabCompareResult, GitLabDiff, GitLabMergeRequest, GitLabMergeRequestVersion, GitLabProject, GitLabRepositoryTreeItem } from "./gitlab-types";

export class GitLabService {
  private readonly client: AxiosInstance;

  constructor(baseUrl: string, accessToken: string) {
    const url = new URL(baseUrl.trim());
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error("GitLab 地址必须是 HTTP 或 HTTPS 实例地址");
    }
    if (!accessToken.trim()) throw new Error("缺少 GitLab accessToken");
    const path = url.pathname.replace(/\/+$/, "").replace(/\/api\/v4$/, "");
    this.client = axios.create({
      baseURL: `${url.origin}${path}/api/v4`,
      headers: { "PRIVATE-TOKEN": accessToken },
      timeout: 30_000,
      maxRedirects: 0,
    });
  }

  getProjects(search?: string, params?: { membership?: boolean; owned?: boolean; per_page?: number }): Promise<GitLabProject[]> {
    return fetchGitLabPages({ client: this.client, path: "/projects",
      params: { membership: true, ...params, search }, perPage: params?.per_page });
  }

  getProject(projectId: number | string): Promise<GitLabProject> {
    return this.client.get<GitLabProject>(`/projects/${encodeURIComponent(projectId)}`).then((response) => response.data);
  }

  getMergeRequest(projectId: number | string, mrIid: number): Promise<GitLabMergeRequest> {
    return this.client.get<GitLabMergeRequest>(`/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}`)
      .then((response) => response.data);
  }

  getMergeRequestVersions(projectId: number | string, mrIid: number): Promise<GitLabMergeRequestVersion[]> {
    return fetchGitLabPages({ client: this.client,
      path: `/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}/versions` });
  }

  getMergeRequestDiffs(projectId: number | string, mrIid: number, versionId?: number): Promise<GitLabDiff[]> {
    const path = `/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}`;
    if (versionId !== undefined) {
      return this.client.get<{ diffs: GitLabDiff[]; overflow?: boolean }>(`${path}/versions/${versionId}`)
        .then((response) => {
          if (response.data.overflow) throw new Error("GitLab MR diff 超过服务端读取上限");
          if (!Array.isArray(response.data.diffs)) throw new Error("GitLab MR version 缺少 diffs");
          return response.data.diffs;
        });
    }
    return fetchGitLabPages({ client: this.client, path: `${path}/diffs` });
  }

  getCommit(projectId: number | string, sha: string): Promise<GitLabCommit> {
    return this.client.get<GitLabCommit>(`/projects/${encodeURIComponent(projectId)}/repository/commits/${encodeURIComponent(sha)}`)
      .then((response) => response.data);
  }

  compare(projectId: number | string, fromSha: string, toSha: string): Promise<GitLabCompareResult> {
    return this.client.get<GitLabCompareResult>(`/projects/${encodeURIComponent(projectId)}/repository/compare`, {
      params: { from: fromSha, to: toSha, straight: true },
    }).then((response) => {
      if (response.data.compare_timeout) throw new Error("GitLab compare 超时，无法获取完整变更");
      return response.data;
    });
  }

  getBranch(projectId: number | string, branch: string): Promise<GitLabBranch> {
    return this.client.get<GitLabBranch>(`/projects/${encodeURIComponent(projectId)}/repository/branches/${encodeURIComponent(branch)}`)
      .then((response) => response.data);
  }

  getBranches(projectId: number | string, params?: { search?: string; per_page?: number; max_pages?: number }): Promise<GitLabBranch[]> {
    return fetchGitLabPages({ client: this.client, path: `/projects/${encodeURIComponent(projectId)}/repository/branches`,
      params: { search: params?.search }, perPage: params?.per_page, maxPages: params?.max_pages });
  }

  getRepositoryTree(projectId: number | string, params: {
    ref: string; path?: string; recursive?: boolean; per_page?: number; max_pages?: number;
  }): Promise<GitLabRepositoryTreeItem[]> {
    return fetchGitLabPages({ client: this.client, path: `/projects/${encodeURIComponent(projectId)}/repository/tree`,
      params: { ref: params.ref, path: params.path, recursive: params.recursive ?? true },
      perPage: params.per_page, maxPages: params.max_pages });
  }

  getRepositoryFileRaw(projectId: number | string, filePath: string, ref: string): Promise<string> {
    return this.client.get<string>(`/projects/${encodeURIComponent(projectId)}/repository/files/${encodeURIComponent(filePath)}/raw`, {
      params: { ref }, responseType: "text", transformResponse: [(data: string) => data],
    }).then((response) => response.data);
  }

  listMergeRequestDiscussions(projectId: number | string, mrIid: number): Promise<GitLabDiscussionResult[]> {
    return fetchGitLabPages<unknown>({ client: this.client,
      path: `/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}/discussions`,
    }).then((discussions) => discussions.map((discussion) => gitLabDiscussion.parse(discussion)));
  }

  getCommitComments(projectId: number | string, sha: string): Promise<GitLabCommitComment[]> {
    return fetchGitLabPages<unknown>({ client: this.client,
      path: `/projects/${encodeURIComponent(projectId)}/repository/commits/${encodeURIComponent(sha)}/discussions`,
    }).then((discussions) => discussions.flatMap(parseCommitDiscussion));
  }

  createMergeRequestComment(projectId: number | string, mrIid: number, comment: string, position?: MergeRequestPosition): Promise<GitLabDiscussionResult> {
    return this.client.post(`/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}/discussions`,
      buildMergeRequestCommentPayload(comment, position)).then((response) => gitLabDiscussion.parse(response.data));
  }

  createCommitComment(projectId: number | string, sha: string, comment: string, options?: CommitCommentOptions): Promise<GitLabCommitComment> {
    const payload = options
      ? this.getCommit(projectId, sha).then((commit) => buildCommitCommentPayload(comment, commit.id, commit.parent_ids[0], options))
      : Promise.resolve(buildCommitCommentPayload(comment, sha));
    return payload.then((data) => this.client.post(
      `/projects/${encodeURIComponent(projectId)}/repository/commits/${encodeURIComponent(sha)}/discussions`, data,
    )).then((response) => parseCommitDiscussion(response.data)[0]);
  }

  createProjectWebhook(projectId: number | string, webhookUrl: string, webhookSecret?: string): Promise<GitLabWebhookResult> {
    return this.client.post<GitLabWebhookResult>(`/projects/${encodeURIComponent(projectId)}/hooks`, {
      url: webhookUrl, merge_requests_events: true, push_events: true, token: webhookSecret,
    }).then((response) => response.data);
  }

  testConnection(): Promise<boolean> {
    return this.client.get("/user").then(() => true);
  }
}

export function createGitLabService(baseUrl: string, accessToken: string): GitLabService {
  return new GitLabService(baseUrl, accessToken);
}
