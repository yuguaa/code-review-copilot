import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const runId = "ac9fe8e9-d50f-4a57-8311-f314f56e5c65";
const repositoryId = "cmvb48kl00002pfjnas6lod1q";
const accountId = "cmvb48kkv0000pfjnslmwgdh1";
if (process.env.CLEANUP_LIVE_VERIFICATION !== runId) throw new Error("需要指定已完成验证的 Run ID");

prisma.$transaction((transaction) => transaction.run.findUniqueOrThrow({
  where: { id: runId }, include: { repository: true },
}).then((run) => {
  assert.equal(run.repositoryId, repositoryId);
  assert.equal(run.sessionId, "cmvb48kn10001pf073vy9liea");
  assert.equal(run.repository.gitLabAccountId, accountId);
  assert.equal(run.repository.name, "部署流程验证");
  assert.equal(run.repository.enableMrComment, false);
  assert.equal(run.repository.enableDingtalk, false);
  assert(["completed", "partial"].includes(run.status));
  assert(run.reportMessageId && run.traceId);
  return transaction.message.findMany({ where: { sessionId: run.sessionId, role: "assistant" } }).then((messages) => {
    assert(messages.some((message) => message.parts.some((part) => part.type === "tool-git_diff"
      && part.state === "output-available" && part.output.baseSha === run.baseSha && part.output.headSha === run.headSha)));
    console.info(JSON.stringify({ runId, status: run.status, traceId: run.traceId, tokens: run.rawResult.summary.total_tokens, verified: true }));
    return transaction.session.delete({ where: { id: run.sessionId } });
  }).then(() => transaction.repository.delete({ where: { id: repositoryId } }))
    .then(() => transaction.gitLabAccount.delete({ where: { id: accountId } }));
})).then(() => console.info("临时验证会话与配置已清理"))
  .finally(() => prisma.$disconnect());
