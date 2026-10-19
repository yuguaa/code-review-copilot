import { createHash, timingSafeEqual } from "node:crypto";

import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { matchesWatchBranches } from "@server/common/utils/branch-match";
import { prisma } from "@server/infrastructure/prisma/prisma.service";
import { assertCommit } from "@server/infrastructure/workspace/workspace.service";
import { createReviewSession } from "@server/platform/runs/run-trigger";
import { createGitLabService } from "@server/shared/gitlab/gitlab.service";

const payloadSchema = z.object({
  project: z.object({ id: z.number().int().positive() }),
  user: z.object({ name: z.string().optional(), username: z.string().optional() }).optional(),
  user_name: z.string().optional(), ref: z.string().optional(), before: z.string().optional(), after: z.string().optional(), checkout_sha: z.string().nullable().optional(),
  object_attributes: z.object({ iid: z.number().int().positive(), title: z.string(), description: z.string().nullable().optional(), source_branch: z.string(), target_branch: z.string(), action: z.string().optional(), last_commit: z.object({ id: z.string() }).optional() }).optional(),
}).passthrough();

function matchesSecret(received: string | undefined | null, expected: string): boolean {
  const left = createHash("sha256").update(received ?? "").digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

type WebhookResult = { status: 200; body: { ignored?: boolean; triggered?: boolean; sessionId?: string } };

export function handleGitLabWebhook(input: { event?: string | null; token?: string | null; body: unknown }): Promise<WebhookResult> {
  if (!["Merge Request Hook", "Push Hook"].includes(input.event ?? "")) return Promise.resolve({ status: 200 as const, body: { ignored: true } });
  const body = payloadSchema.parse(input.body);
  return prisma.repository.findMany({ where: { gitLabProjectId: body.project.id, isActive: true }, include: { gitLabAccount: true } }).then<WebhookResult>((repositories) => {
    const matches = repositories.filter((repo) => repo.gitLabAccount.isActive && repo.gitLabAccount.webhookSecret && matchesSecret(input.token, repo.gitLabAccount.webhookSecret));
    if (matches.length !== 1) throw new HTTPException(401, { message: "Webhook 凭证无效或项目配置不唯一" });
    const repo = matches[0];
    if (!repo.autoReview) return { status: 200 as const, body: { ignored: true } };
    const attrs = body.object_attributes;
    const isMr = input.event === "Merge Request Hook";
    if (isMr && (!attrs || (attrs.action && !["open", "reopen", "update"].includes(attrs.action)))) return { status: 200 as const, body: { ignored: true } };
    const branch = isMr ? attrs!.target_branch : body.ref?.replace(/^refs\/heads\//, "");
    if (!branch || !matchesWatchBranches(repo.watchBranches, branch)) return { status: 200 as const, body: { ignored: true } };
    const headSha = isMr ? attrs!.last_commit?.id : body.checkout_sha ?? body.after;
    if (!headSha || /^0+$/.test(headSha) || (!isMr && (!body.before || /^0+$/.test(body.before)))) return { status: 200 as const, body: { ignored: true } };
    assertCommit(headSha);
    const gitlab = createGitLabService(repo.gitLabAccount.url, repo.gitLabAccount.accessToken);
    const range = isMr ? gitlab.getMergeRequestVersions(repo.gitLabProjectId, attrs!.iid).then((versions) => {
      const version = versions.find((item) => item.head_commit_sha === headSha);
      if (!version) throw new HTTPException(409, { message: "GitLab 尚未提供该提交的 MR diff 版本" });
      return { baseSha: assertCommit(version.base_commit_sha), startSha: assertCommit(version.start_commit_sha), headSha };
    }) : Promise.resolve({ baseSha: assertCommit(body.before!), startSha: body.before!, headSha });
    return range.then((refs) => {
      const eventKey = `${repo.id}:${isMr ? `mr:${attrs!.iid}` : `push:${branch}`}:${refs.baseSha}:${headSha}`;
      return prisma.run.findUnique({ where: { eventKey } }).then((existing) => {
        if (existing) return { status: 200 as const, body: { triggered: false, sessionId: existing.sessionId } };
        return createReviewSession({
          repositoryId: repo.id, title: isMr ? attrs!.title : `Push ${branch}`,
          mrIid: isMr ? attrs!.iid : null, mrTitle: isMr ? attrs!.title : null,
          sourceBranch: isMr ? attrs!.source_branch : branch, targetBranch: branch,
          baseCommitSha: refs.baseSha, commitSha: headSha, author: body.user?.name ?? body.user_name,
        }, { ...refs, triggerType: isMr ? "merge_request" : "push", eventKey,
          background: isMr ? [attrs!.title, attrs!.description].filter(Boolean).join("\n\n") : `Push ${branch}`,
        }).then((result) => ({ status: 200 as const, body: { triggered: result.created, sessionId: result.sessionId } }));
      });
    });
  });
}
