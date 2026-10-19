import axios from "axios";
import { describe, expect, it } from "vitest";

import { fetchGitLabPages } from "./gitlab-pagination";
import { GitLabService } from "./gitlab.service";

describe("GitLab 请求校验", () => {
  it.each([0, -1, 101, 1.5])("无效分页大小 %s 在 HTTP 请求前失败", (perPage) => {
    expect(() => fetchGitLabPages({ client: axios.create(), path: "/projects", perPage })).toThrow("perPage");
  });
  it.each([0, -1, 1.5])("无效页面上限 %s 在 HTTP 请求前失败", (maxPages) => {
    expect(() => fetchGitLabPages({ client: axios.create(), path: "/projects", maxPages })).toThrow("maxPages");
  });
  it("拒绝包含用户名密码的 GitLab 地址和空白 Token", () => {
    expect(() => new GitLabService("https://user:secret@example.com", "token")).toThrow("实例地址");
    expect(() => new GitLabService("https://example.com", " ")).toThrow("accessToken");
  });
});
