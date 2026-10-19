import { z } from "zod";

import type { GitLabCommitComment } from "./gitlab-types";

export type MergeRequestPosition = {
  base_sha: string;
  head_sha: string;
  start_sha: string;
  old_path: string;
  new_path: string;
  position_type: "text";
  new_line?: number;
  old_line?: number;
};

export type CommitCommentOptions = {
  path?: string;
  old_path?: string;
  line?: number;
  line_type?: "new" | "old";
};

export const gitLabDiscussion = z.object({
  id: z.string().min(1),
  notes: z.array(z.object({ id: z.number().int().positive(), body: z.string() }).passthrough()).min(1),
}).passthrough();

export type GitLabDiscussionResult = z.infer<typeof gitLabDiscussion>;
export type GitLabWebhookResult = { id: number; url: string };
export type MergeRequestCommentPayload = { body: string; position?: MergeRequestPosition };

const positionInput = z.object({
  base_sha: z.string().min(1),
  head_sha: z.string().min(1),
  start_sha: z.string().min(1),
  old_path: z.string().min(1),
  new_path: z.string().min(1),
  position_type: z.literal("text"),
  new_line: z.number().int().positive().optional(),
  old_line: z.number().int().positive().optional(),
}).refine((position) => position.new_line !== undefined || position.old_line !== undefined, "行级评论需要行号");

export function buildMergeRequestCommentPayload(comment: string, position?: MergeRequestPosition): MergeRequestCommentPayload {
  if (!comment.trim()) throw new Error("GitLab 评论内容不能为空");
  return position ? { body: comment, position: positionInput.parse(position) } : { body: comment };
}

export function buildCommitCommentPayload(
  comment: string,
  commitSha: string,
  parentSha?: string,
  options?: CommitCommentOptions,
): MergeRequestCommentPayload {
  if (!options) return buildMergeRequestCommentPayload(comment);
  if (!parentSha || !options.path || !options.line) throw new Error("Commit 行级评论需要父级提交、文件路径和行号");
  return buildMergeRequestCommentPayload(comment, {
    base_sha: parentSha, start_sha: parentSha, head_sha: commitSha,
    old_path: options.old_path ?? options.path, new_path: options.path, position_type: "text",
    ...(options.line_type === "old" ? { old_line: options.line } : { new_line: options.line }),
  });
}

export function parseCommitDiscussion(value: unknown): GitLabCommitComment[] {
  const discussion = gitLabDiscussion.parse(value);
  return discussion.notes.map((note) => ({
    id: note.id, note_id: note.id, discussion_id: discussion.id, note: note.body,
  }));
}
