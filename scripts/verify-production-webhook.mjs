import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import { PrismaClient } from "@prisma/client";

import { createGitLabService } from "../server/shared/gitlab/gitlab.service.ts";

if (process.env.VERIFY_PRODUCTION_WEBHOOK !== "1") throw new Error("请明确启用生产 Webhook 审查验证");

const target = {
  repositoryId: "cmtm9p8wh00ljoa01pwuejpbf",
  projectId: 11181,
  branch: "main",
  baseSha: "bc3e96b0640444f7564bbf26deabc12444e5170c",
  headSha: "78bcdddf21c2284123d2f46efad2348bf71a180f",
  author: "lix",
};
const prisma = new PrismaClient();
const deadline = Date.now() + 20 * 60_000;

function waitForPublication(sessionId) {
  return prisma.run.findFirstOrThrow({ where: { sessionId }, orderBy: { createdAt: "desc" } }).then((run) => {
    const deliveries = run.deliveries ?? {};
    const active = ["queued", "running", "cancelling"].includes(run.status);
    const publishing = !deliveries.gitlab || !deliveries.dingtalk
      || ["sending"].includes(deliveries.gitlab.status) || ["sending"].includes(deliveries.dingtalk.status);
    if (!active && !publishing) return run;
    assert(Date.now() < deadline, "生产 Webhook 审查或发布超过时间限制");
    return delay(2000).then(() => waitForPublication(sessionId));
  });
}

prisma.repository.findUniqueOrThrow({
  where: { id: target.repositoryId }, include: { gitLabAccount: true, dingtalkRobot: true },
}).then((repository) => {
  assert.equal(repository.gitLabProjectId, target.projectId);
  assert.equal(repository.enableMrComment, true, "仓库未启用 GitLab 评论");
  assert.equal(repository.enableDingtalk, true, "仓库未启用钉钉通知");
  assert(repository.dingtalkRobot?.enabled, "仓库选择的钉钉机器人未启用");
  assert(repository.gitLabAccount.webhookSecret, "GitLab Webhook Secret 未配置");
  return fetch("http://127.0.0.1:8787/api/webhook/gitlab", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Gitlab-Event": "Push Hook", "X-Gitlab-Token": repository.gitLabAccount.webhookSecret },
    body: JSON.stringify({ project: { id: target.projectId }, ref: `refs/heads/${target.branch}`,
      before: target.baseSha, after: target.headSha, checkout_sha: target.headSha, user_name: target.author }),
    signal: AbortSignal.timeout(15_000),
  });
}).then((response) => {
  assert.equal(response.status, 200);
  return response.json();
}).then((accepted) => {
  assert(accepted.sessionId, "Webhook 没有创建或返回审查会话");
  console.info(JSON.stringify({ phase: "webhook-accepted", triggered: accepted.triggered, sessionId: accepted.sessionId }));
  return waitForPublication(accepted.sessionId);
}).then((run) => {
  assert(["completed", "partial", "skipped"].includes(run.status), run.error ?? `审查状态 ${run.status}`);
  assert(run.reportMessageId && run.traceId, "OCR 报告或 Trace 未保存");
  assert.equal(run.deliveries.gitlab?.status, "sent", `GitLab 发布状态 ${run.deliveries.gitlab?.status}`);
  assert.equal(run.deliveries.dingtalk?.status, "sent", `钉钉发布状态 ${run.deliveries.dingtalk?.status}`);
  assert(run.deliveries.gitlab.remoteIds?.length, "GitLab 评论远端标识未保存");
  assert(run.deliveries.gitlab.noteIds?.length, "GitLab 评论编号未保存");
  return prisma.repository.findUniqueOrThrow({ where: { id: target.repositoryId }, include: { gitLabAccount: true } })
    .then((repository) => createGitLabService(repository.gitLabAccount.url, repository.gitLabAccount.accessToken)
      .getCommitComments(target.projectId, target.headSha)).then((comments) => {
      const published = comments.find((comment) => run.deliveries.gitlab.noteIds.includes(comment.note_id));
      assert(published?.note.includes("# 代码审查报告"), "GitLab 没有保存对应的审查评论");
      assert(published.note.includes("<!-- code-review:"), "GitLab 评论缺少幂等标记");
      console.info(JSON.stringify({ phase: "review-published", runId: run.id, status: run.status, traceId: run.traceId,
        gitlab: run.deliveries.gitlab.status, dingtalk: run.deliveries.dingtalk.status, gitlabNoteId: published.note_id }));
    });
}).finally(() => prisma.$disconnect());
