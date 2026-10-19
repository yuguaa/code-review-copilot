import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";
import { DefaultChatTransport, readUIMessageStream } from "ai";

if (process.env.VERIFY_LIVE_REVIEW !== "1") throw new Error("请明确启用真实模型与仓库验证");
const existingRunId = process.env.VERIFY_RUN_ID;
const commitSha = process.env.VERIFY_COMMIT_SHA;
if (commitSha && !/^[a-f0-9]{40}$/i.test(commitSha)) throw new Error("VERIFY_COMMIT_SHA 必须为完整的 40 位提交 SHA");
const prisma = new PrismaClient();
const { createGitLabService } = await import(pathToFileURL(resolve("server/shared/gitlab/gitlab.service.ts")).href);
const root = "http://127.0.0.1:8787";
let accountId;
let repositoryId;
let sessionId;
let runId = existingRunId;
let cookie;
let succeeded = false;
const secrets = [process.env.APP_AUTH_SECRET, process.env.APP_AUTH_SESSION_SECRET].filter(Boolean);
const redact = (message) => secrets.reduce((value, secret) => value.replaceAll(secret, "[REDACTED]"), message);
try {
  if (existingRunId) {
    /* 复用记录只继续验证追问，保留原有会话和配置。 */
    const existing = await prisma.run.findUniqueOrThrow({ where: { id: existingRunId }, include: { repository: { include: { gitLabAccount: true, defaultAIModel: true } } } });
    assert(existing.repository, "已有审查缺少仓库配置");
    sessionId = existing.sessionId;
    repositoryId = existing.repositoryId;
    accountId = existing.repository.gitLabAccountId;
    secrets.push(...[existing.repository.gitLabAccount.accessToken, existing.repository.gitLabAccount.webhookSecret,
      existing.repository.customApiKey, existing.repository.defaultAIModel?.apiKey].filter(Boolean));
    const defaultModel = await prisma.aIModel.findFirst({ where: { isDefault: true, isActive: true } });
    if (defaultModel?.apiKey) secrets.push(defaultModel.apiKey);
    if (commitSha) assert.equal(existing.headSha?.toLowerCase(), commitSha.toLowerCase(), "已有审查与指定提交不一致");
    console.info(JSON.stringify({ phase: "复用真实审查", runId, sessionId, repositoryId, accountId }));
  } else {
    const original = await prisma.repository.findFirstOrThrow({ where: { isActive: true, gitLabAccount: { isActive: true } }, include: { gitLabAccount: true } });
    const model = await prisma.aIModel.findFirstOrThrow({ where: { isDefault: true, isActive: true } });
    secrets.push(original.gitLabAccount.accessToken, model.apiKey);
    const gitlab = createGitLabService(original.gitLabAccount.url, original.gitLabAccount.accessToken);
    const project = await gitlab.getProject(original.gitLabProjectId);
    assert(project.default_branch, "真实仓库没有默认分支");
    const targetSha = commitSha ?? await gitlab.getBranch(project.id, project.default_branch).then((branch) => branch.commit.id);
    const commit = await gitlab.getCommit(project.id, targetSha);
    const baseSha = commit.parent_ids[0];
    assert(baseSha, "真实提交没有父提交");
    const comparison = await gitlab.compare(project.id, baseSha, commit.id);
    assert(comparison.diffs.length > 0, "真实提交没有变更");
    console.info(JSON.stringify({ phase: "真实提交已确认", projectId: project.id, baseSha, headSha: commit.id, filesChanged: comparison.diffs.length, model: model.modelId }));
    const webhookSecret = randomUUID();
    secrets.push(webhookSecret);
    const account = await prisma.gitLabAccount.create({ data: { url: original.gitLabAccount.url, accessToken: original.gitLabAccount.accessToken, webhookSecret, isActive: true } });
    accountId = account.id;
    const repository = await prisma.repository.create({ data: { gitLabAccountId: accountId, gitLabProjectId: project.id,
      name: "部署流程验证", path: original.path, autoReview: true, watchBranches: project.default_branch,
      defaultAIModelId: model.id, enableMrComment: false, enableDingtalk: false,
    } });
    repositoryId = repository.id;
    const response = await fetch(`${root}/api/webhook/gitlab`, { method: "POST", headers: { "Content-Type": "application/json", "X-Gitlab-Event": "Push Hook", "X-Gitlab-Token": webhookSecret },
      body: JSON.stringify({ project: { id: project.id }, ref: `refs/heads/${project.default_branch}`, before: baseSha, after: commit.id, checkout_sha: commit.id, user_name: "部署流程验证" }),
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(response.status, 200);
    const accepted = await response.json();
    sessionId = accepted.sessionId;
    assert(sessionId, "Webhook 没有返回会话 ID");
    assert.equal(accepted.triggered, true);
  }
  let run;
  let previousStatus;
  const deadline = Date.now() + 20 * 60_000;
  do {
    run = runId ? await prisma.run.findUniqueOrThrow({ where: { id: runId } })
      : await prisma.run.findFirstOrThrow({ where: { sessionId } });
    runId = run.id;
    if (run.status !== previousStatus) { console.info(JSON.stringify({ phase: "运行状态", runId, sessionId, repositoryId, accountId, status: run.status })); previousStatus = run.status; }
    if (!["queued", "running", "cancelling"].includes(run.status)) break;
    assert(Date.now() < deadline, "真实审查超过验证时间限制");
    await delay(2000);
  } while (true);
  assert(["completed", "partial"].includes(run.status), run.error ?? `实际运行状态 ${run.status}`);
  assert(/^[a-f0-9]{40}$/i.test(run.baseSha ?? "") && /^[a-f0-9]{40}$/i.test(run.headSha ?? ""), "审查缺少完整提交范围");
  assert(run.reportMessageId && run.traceId && run.rawResult?.summary?.total_tokens > 0, "审查没有完整保存报告、Trace ID 或真实 Token 使用记录");
  const report = await prisma.message.findUniqueOrThrow({ where: { id: run.reportMessageId } });
  assert(report.parts.some((part) => part.type === "text" && part.text.includes("代码审查报告")));
  console.info(JSON.stringify({ phase: "真实 OCR 报告已保存", status: run.status, tokens: run.rawResult.summary.total_tokens, traceId: run.traceId }));
  const login = await fetch(`${root}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: process.env.APP_AUTH_USERNAME, secret: process.env.APP_AUTH_SECRET }), signal: AbortSignal.timeout(15_000) });
  assert.equal(login.status, 200);
  assert(login.headers.get("set-cookie"), "登录没有返回会话凭证");
  cookie = login.headers.get("set-cookie").split(";")[0];
  secrets.push(cookie);
  const transport = new DefaultChatTransport({ api: `${root}/api/chat`, headers: { Cookie: cookie }, body: { sessionId, runId: run.id } });
  const userMessageId = randomUUID();
  const stream = await transport.sendMessages({ chatId: sessionId, trigger: "submit-message", messageId: undefined,
    messages: [{ id: userMessageId, role: "user", parts: [{ type: "text", text: "请调用 git_diff 确认本次审查的固定提交范围，等待工具返回后，用一句话回答两端完整的 40 位 SHA。" }] }],
    abortSignal: AbortSignal.timeout(180_000),
  });
  let answer;
  for await (const message of readUIMessageStream({ stream, terminateOnError: true })) answer = message;
  const answerText = answer?.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n") ?? "";
  console.info(JSON.stringify({ phase: "真实追问回答", runId, answer: redact(answerText) }));
  assert(answerText.trim(), "真实模型没有输出可见追问回答");
  assert(answerText.toLowerCase().includes(run.baseSha.toLowerCase()) && answerText.toLowerCase().includes(run.headSha.toLowerCase()), "追问回答没有包含本次审查两端完整 SHA");
  const diffCalls = answer.parts.filter((part) => part.type === "tool-git_diff" || (part.type === "dynamic-tool" && part.toolName === "git_diff"));
  assert(diffCalls.length > 0, "真实追问没有调用 git_diff");
  for (const part of diffCalls) {
    assert.equal(part.state, "output-available", "git_diff 工具调用没有完成");
    assert.equal(part.output?.baseSha, run.baseSha, "git_diff 的 baseSha 与审查记录不一致");
    assert.equal(part.output?.headSha, run.headSha, "git_diff 的 headSha 与审查记录不一致");
    assert.equal(typeof part.output?.content, "string", "git_diff 没有返回差异内容");
    assert(part.output.content.trim(), "git_diff 返回的差异为空");
  }
  console.info(JSON.stringify({ phase: "git_diff 工具调用已完成", runId, calls: diffCalls.length, baseSha: run.baseSha, headSha: run.headSha }));
  const savedAnswer = await prisma.message.findUniqueOrThrow({ where: { id: answer.id } });
  assert.equal(savedAnswer.sessionId, sessionId);
  assert.equal(savedAnswer.parentId, userMessageId);
  assert.equal(savedAnswer.role, "assistant");
  assert.deepEqual(savedAnswer.parts, JSON.parse(JSON.stringify(answer.parts)), "追问回答与已保存消息不一致");
  console.info("真实模型追问与 AI SDK 消息流验证通过");
  let trace;
  const traceDeadline = Date.now() + 30_000;
  do {
    const traceResponse = await fetch(`http://tempo:3200/api/traces/${run.traceId}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (traceResponse.ok) trace = await traceResponse.text();
    if (trace?.includes("code-review-ocr") && trace.includes("code-review-copilot")) break;
    assert(Date.now() < traceDeadline, "同一 Trace 尚未同时包含平台与 OCR");
    await delay(1000);
  } while (true);
  assert(JSON.parse(trace));
  console.info("真实 OCR 与平台出现在同一个 Trace，验证通过");
  succeeded = true;
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : "真实流程验证失败"));
  console.info(JSON.stringify({ phase: "验证失败，保留真实记录", runId, sessionId, repositoryId, accountId }));
  process.exitCode = 1;
} finally {
  try {
    if (succeeded && !existingRunId) {
      if (sessionId) await prisma.session.deleteMany({ where: { id: sessionId } });
      if (repositoryId) await prisma.repository.deleteMany({ where: { id: repositoryId } });
      if (accountId) await prisma.gitLabAccount.deleteMany({ where: { id: accountId } });
    }
  } finally {
    try {
      if (cookie) await fetch(`${root}/api/auth/logout`, { method: "POST", headers: { Cookie: cookie }, signal: AbortSignal.timeout(15_000) });
    } finally {
      await prisma.$disconnect();
    }
  }
}
