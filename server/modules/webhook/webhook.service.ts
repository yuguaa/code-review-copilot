import { createHash, timingSafeEqual } from "node:crypto";

import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { matchesWatchBranches } from "@server/common/utils/branch-match";
import { prisma } from "@server/infrastructure/prisma/prisma.service";
import { assertCommit } from "@server/infrastructure/workspace/workspace.service";
import { createReviewSession } from "@server/platform/runs/run-trigger";
import { createGitLabService } from "@server/shared/gitlab/gitlab.service";
import { createLogger } from "@server/shared/logger/logger.service";

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

const log = createLogger("gitlab-webhook");

type WebhookContext = {
  event: string;
  projectId: number;
  repositoryId?: string;
  branch?: string;
  sourceBranch?: string;
  mrIid?: number;
  headSha?: string;
};

type WebhookResult = {
  status: 200;
  body: { ignored?: boolean; reason?: string; triggered?: boolean; sessionId?: string };
};

function ignored(context: WebhookContext, reason: string): WebhookResult {
  log.info("GitLab Webhook 已忽略", { ...context, reason });
  return { status: 200 as const, body: { ignored: true, reason } };
}

export function handleGitLabWebhook(input: { event?: string | null; token?: string | null; body: unknown }): Promise<WebhookResult> {
  if (!["Merge Request Hook", "Push Hook"].includes(input.event ?? "")) {
    const reason = "仅处理 Merge Request Hook 与 Push Hook";
    log.debug("GitLab Webhook 事件类型不受支持", { event: input.event ?? "missing", reason });
    return Promise.resolve({ status: 200 as const, body: { ignored: true, reason } });
  }
  const event = input.event!;
  const body = payloadSchema.parse(input.body);
  const baseContext: WebhookContext = { event, projectId: body.project.id };
  log.info("收到 GitLab Webhook", baseContext);
  return prisma.repository.findMany({ where: { gitLabProjectId: body.project.id, isActive: true }, include: { gitLabAccount: true } }).then<WebhookResult>((repositories) => {
    const matches = repositories.filter((repo) => repo.gitLabAccount.isActive && repo.gitLabAccount.webhookSecret && matchesSecret(input.token, repo.gitLabAccount.webhookSecret));
    log.info("GitLab Webhook 仓库配置匹配完成", {
      ...baseContext,
      repositoryCount: repositories.length,
      activeAccountCount: repositories.filter((repo) => repo.gitLabAccount.isActive).length,
      secretMatchedCount: matches.length,
    });
    if (matches.length !== 1) {
      log.warn("GitLab Webhook 凭证无效或项目配置不唯一", {
        ...baseContext,
        repositoryCount: repositories.length,
        secretMatchedCount: matches.length,
      });
      throw new HTTPException(401, { message: "Webhook 凭证无效或项目配置不唯一" });
    }
    const repo = matches[0];
    const context = { ...baseContext, repositoryId: repo.id };
    if (!repo.autoReview) return ignored(context, "仓库未启用自动审查");
    const attrs = body.object_attributes;
    const isMr = event === "Merge Request Hook";
    if (isMr && !attrs) return ignored(context, "Merge Request Hook 缺少 object_attributes");
    if (isMr && attrs?.action && !["open", "reopen", "update"].includes(attrs.action)) {
      return ignored({ ...context, mrIid: attrs.iid, sourceBranch: attrs.source_branch, branch: attrs.target_branch }, `MR 动作 ${attrs.action} 不触发审查`);
    }
    const branch = isMr ? attrs!.target_branch : body.ref?.replace(/^refs\/heads\//, "");
    const eventContext = { ...context, branch, sourceBranch: attrs?.source_branch, mrIid: attrs?.iid };
    if (!branch) return ignored(eventContext, "Webhook 缺少目标分支");
    if (!matchesWatchBranches(repo.watchBranches, branch)) return ignored(eventContext, `目标分支 ${branch} 不在监听范围`);
    const headSha = isMr ? attrs!.last_commit?.id : body.checkout_sha ?? body.after;
    if (!headSha) return ignored(eventContext, "Webhook 缺少目标提交");
    if (/^0+$/.test(headSha)) return ignored({ ...eventContext, headSha }, "目标提交为空，通常是分支删除事件");
    if (!isMr && (!body.before || /^0+$/.test(body.before))) return ignored({ ...eventContext, headSha }, "Push Hook 缺少起始提交，通常是新分支事件");
    const commitContext = { ...eventContext, headSha };
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
        if (existing) {
          log.info("GitLab Webhook 命中已有审查", { ...commitContext, eventKey, sessionId: existing.sessionId });
          return { status: 200 as const, body: { triggered: false, sessionId: existing.sessionId } };
        }
        return createReviewSession({
          repositoryId: repo.id, title: isMr ? attrs!.title : `Push ${branch}`,
          mrIid: isMr ? attrs!.iid : null, mrTitle: isMr ? attrs!.title : null,
          sourceBranch: isMr ? attrs!.source_branch : branch, targetBranch: branch,
          baseCommitSha: refs.baseSha, commitSha: headSha, author: body.user?.name ?? body.user_name,
        }, { ...refs, triggerType: isMr ? "merge_request" : "push", eventKey,
          background: isMr ? [attrs!.title, attrs!.description].filter(Boolean).join("\n\n") : `Push ${branch}`,
        }).then((result) => {
          log.info("GitLab Webhook 已创建审查", {
            ...commitContext, eventKey, sessionId: result.sessionId, runId: result.runId, triggered: result.created,
          });
          return { status: 200 as const, body: { triggered: result.created, sessionId: result.sessionId } };
        });
      });
    });
  }).catch((error: unknown) => {
    log.error("GitLab Webhook 处理失败", { ...baseContext, err: error });
    throw error;
  });
}
