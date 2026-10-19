import { describe, expect, it } from "vitest";

import { buildCommitCommentPayload, buildMergeRequestCommentPayload, gitLabDiscussion, parseCommitDiscussion } from "./gitlab-comments";

describe("GitLab 评论", () => {
  it("MR 评论保持完整的提交范围和行号", () => {
    const position = { base_sha: "base", start_sha: "start", head_sha: "head", old_path: "a.ts", new_path: "a.ts", position_type: "text" as const, new_line: 12 };
    expect(buildMergeRequestCommentPayload("问题", position)).toEqual({ body: "问题", position });
  });
  it("Commit 行级评论以父级提交定位修改", () => {
    expect(buildCommitCommentPayload("问题", "head", "parent", { path: "new.ts", old_path: "old.ts", line: 8, line_type: "new" }))
      .toEqual({ body: "问题", position: {
        base_sha: "parent", start_sha: "parent", head_sha: "head", old_path: "old.ts", new_path: "new.ts", position_type: "text", new_line: 8,
      } });
  });
  it("缺少行级定位信息立即失败", () => {
    expect(() => buildCommitCommentPayload("问题", "head", undefined, { path: "a.ts", line: 8 })).toThrow("父级提交");
    expect(() => buildCommitCommentPayload("问题", "head", "parent", { path: "a.ts", line: 0 })).toThrow("行号");
  });
  it("普通评论保留隐藏 marker", () => {
    expect(buildCommitCommentPayload("报告\n<!-- review:run-1 -->", "head")).toEqual({ body: "报告\n<!-- review:run-1 -->" });
  });
  it("发布响应必须包含 discussion ID 和 note ID", () => {
    expect(gitLabDiscussion.safeParse({ id: "discussion", notes: [] }).success).toBe(false);
    expect(gitLabDiscussion.safeParse({ id: "discussion", notes: [{ body: "报告" }] }).success).toBe(false);
    expect(gitLabDiscussion.parse({ id: "discussion", notes: [{ id: 1, body: "报告" }] }).notes[0].id).toBe(1);
  });
  it("Commit Discussion 保留所有评论正文和对应远端标识", () => {
    expect(parseCommitDiscussion({ id: "discussion", notes: [
      { id: 1, body: "报告\n<!-- review:run-1 -->" }, { id: 2, body: "回复" },
    ] })).toEqual([
      { id: 1, note_id: 1, discussion_id: "discussion", note: "报告\n<!-- review:run-1 -->" },
      { id: 2, note_id: 2, discussion_id: "discussion", note: "回复" },
    ]);
  });
});
