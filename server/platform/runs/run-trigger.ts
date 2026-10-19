import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { prisma } from "@server/infrastructure/prisma/prisma.service";
import { createGitLabService } from "@server/shared/gitlab/gitlab.service";
import { enqueueRun } from "./run-service";

import type { Prisma } from "@prisma/client";
import type { EnqueueRequest } from "./run-service";

const common = { repositoryId: z.string().min(1).max(200), requestId: z.string().uuid() };
const manualInput = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("commit"), sha: z.string().regex(/^[a-f0-9]{40}$/i).optional() }).strict(),
  z.object({ ...common, kind: z.literal("merge_request"), mrIid: z.number().int().positive() }).strict(),
]);

export function createManualReview(body: unknown) {
  const input = manualInput.parse(body);
  const eventKey = `manual:${input.requestId}`;
  return prisma.run.findUnique({ where: { eventKey }, include: { session: { select: { mrIid: true } } } }).then((existing) => {
    if (existing) {
      if (existing.repositoryId !== input.repositoryId || existing.session.mrIid !== (input.kind === "merge_request" ? input.mrIid : null)
        || (input.kind === "commit" && input.sha && existing.headSha !== input.sha.toLowerCase())) throw new HTTPException(409, { message: "请求标识已经用于其他审查请求" });
      return { created: false, sessionId: existing.sessionId, runId: existing.id };
    }
    return prisma.repository.findUnique({ where: { id: input.repositoryId }, include: { gitLabAccount: true } }).then((repository) => {
      if (!repository?.isActive || !repository.gitLabAccount.isActive) throw new HTTPException(400, { message: "仓库不存在或已停用" });
      const gitlab = createGitLabService(repository.gitLabAccount.url, repository.gitLabAccount.accessToken);
      if (input.kind === "merge_request") return gitlab.getMergeRequest(repository.gitLabProjectId, input.mrIid).then((mr) => {
        if (!mr.diff_refs) throw new HTTPException(409, { message: "GitLab 尚未生成 MR 的提交范围" });
        return createReviewSession({ repositoryId: repository.id, title: mr.title, mrTitle: mr.title, mrIid: mr.iid,
          sourceBranch: mr.source_branch, targetBranch: mr.target_branch, author: mr.author.name,
          baseCommitSha: mr.diff_refs.base_sha, commitSha: mr.diff_refs.head_sha,
        }, { eventKey, triggerType: "manual", baseSha: mr.diff_refs.base_sha, startSha: mr.diff_refs.start_sha, headSha: mr.diff_refs.head_sha,
          background: [mr.title, mr.description].filter(Boolean).join("\n\n"),
        });
      });
      const head = input.sha ? Promise.resolve(input.sha) : gitlab.getProject(repository.gitLabProjectId).then((project) => {
        if (!project.default_branch) throw new HTTPException(400, { message: "仓库没有默认分支" });
        return gitlab.getBranch(repository.gitLabProjectId, project.default_branch).then((branch) => branch.commit.id);
      });
      return head.then((sha) => gitlab.getCommit(repository.gitLabProjectId, sha)).then((commit) => {
        if (!commit.parent_ids.length) throw new HTTPException(400, { message: "该提交没有父提交，无法执行差异审查" });
        return createReviewSession({ repositoryId: repository.id, title: commit.title, author: commit.author_name, baseCommitSha: commit.parent_ids[0], commitSha: commit.id }, {
          eventKey, triggerType: "manual", baseSha: commit.parent_ids[0], startSha: commit.parent_ids[0], headSha: commit.id, background: commit.message,
        });
      });
    });
  });
}

export function createReviewSession(seed: SessionSeed, request: Omit<EnqueueRequest, "sessionId">): Promise<TriggeredRun> {
  return prisma.session.create({ data: { ...seed, kind: "review", status: "completed" } }).then((session) => enqueueRun({ ...request, sessionId: session.id })
    .then(() => prisma.run.findFirstOrThrow({ where: { sessionId: session.id } }))
    .then((run) => ({ created: true, sessionId: session.id, runId: run.id }))
    .catch((error: unknown) => prisma.run.count({ where: { sessionId: session.id } }).then((accepted) => {
      /* 已提交的任务保留，调用方可使用请求标识查询同一次执行。 */
      if (accepted) throw error;
      return prisma.session.delete({ where: { id: session.id } }).then(() => {
        if ((error as { code?: string }).code !== "P2002" || !request.eventKey) throw error;
        return prisma.run.findUniqueOrThrow({ where: { eventKey: request.eventKey }, include: { session: { select: { mrIid: true } } } }).then((existing) => {
          if (existing.repositoryId !== seed.repositoryId || existing.headSha !== request.headSha
            || existing.session.mrIid !== (seed.mrIid ?? null)) throw new HTTPException(409, { message: "请求标识已经用于其他审查请求" });
          return { created: false, sessionId: existing.sessionId, runId: existing.id };
        });
      });
    })));
}

type SessionSeed = Pick<Prisma.SessionUncheckedCreateInput, "title" | "mrTitle" | "mrIid" | "sourceBranch" | "targetBranch" | "author" | "baseCommitSha" | "commitSha"> & { repositoryId: string };
type TriggeredRun = { created: boolean; sessionId: string; runId: string };
