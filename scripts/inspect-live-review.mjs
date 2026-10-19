import { PrismaClient } from "@prisma/client";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const commitSha = process.env.VERIFY_COMMIT_SHA;
if (commitSha && !/^[a-f0-9]{40}$/i.test(commitSha)) throw new Error("VERIFY_COMMIT_SHA 必须为完整的 40 位提交 SHA");
const prisma = new PrismaClient();
try {
  const run = process.env.VERIFY_RUN_ID
    ? await prisma.run.findUniqueOrThrow({ where: { id: process.env.VERIFY_RUN_ID }, include: { repository: { include: { gitLabAccount: true } } } })
    : null;
  if (run) console.info(JSON.stringify({ runId: run.id, sessionId: run.sessionId, repositoryId: run.repositoryId,
    accountId: run.repository?.gitLabAccountId, status: run.status, baseSha: run.baseSha, headSha: run.headSha, traceId: run.traceId }));
  const traceId = process.env.TRACE_ID ?? run?.traceId;
  if (traceId) {
    if (!/^[a-f0-9]{32}$/i.test(traceId)) throw new Error("Trace ID 无效");
    const response = await fetch(`http://tempo:3200/api/traces/${traceId}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Trace 查询失败：${response.status}`);
    const trace = await response.text();
    JSON.parse(trace);
    console.info(JSON.stringify({ traceId, platform: trace.includes("code-review-copilot"), ocr: trace.includes("code-review-ocr") }));
  }
  if (run && !run.repository) throw new Error("已有审查缺少仓库配置");
  const { createGitLabService } = await import(pathToFileURL(resolve("server/shared/gitlab/gitlab.service.ts")).href);
  const repository = run ? run.repository : await prisma.repository.findFirstOrThrow({ where: { isActive: true, gitLabAccount: { isActive: true } }, include: { gitLabAccount: true } });
  const gitlab = createGitLabService(repository.gitLabAccount.url, repository.gitLabAccount.accessToken);
  const project = await gitlab.getProject(repository.gitLabProjectId);
  const targetSha = commitSha ?? run?.headSha ?? await gitlab.getBranch(project.id, project.default_branch).then((branch) => branch.commit.id);
  let commit = await gitlab.getCommit(project.id, targetSha);
  for (let index = 0; index < (commitSha || run ? 1 : 4) && commit.parent_ids.length; index++) {
    const comparison = await gitlab.compare(project.id, commit.parent_ids[0], commit.id);
    console.info(JSON.stringify({ projectId: project.id, baseSha: commit.parent_ids[0], commitSha: commit.id, filesChanged: comparison.diffs.length }));
    if (!commitSha && !run && index < 3) commit = await gitlab.getCommit(project.id, commit.parent_ids[0]);
  }
} finally {
  await prisma.$disconnect();
}
