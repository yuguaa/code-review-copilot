import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import { securityConfig } from "@server/config/security.config";
import { prisma } from "@server/infrastructure/prisma/prisma.service";
import { loadActiveModelConfig, loadGlobalDefaultModel, resolveGlobalModelConfig } from "@server/modules/ai-models/ai-models.service";
import { loadDingtalkConfig, sendDingtalkNotification } from "@server/modules/notifications/notifications.service";
import { buildSecurityReport, buildSecurityReportHtml } from "@server/modules/security/security-report";
import { decryptSecret } from "@server/modules/security/security-secret.service";
import {
  claimNextSecurityTicket,
  createSecurityEvent,
  createSecurityExecution,
  finishSecurityExecution,
  finishSecurityTicket,
  publishSecurityTicketChanged,
} from "@server/modules/security/security-tickets.service";
import { redactSecrets } from "@server/platform/engines/ocr-engine";
import { withSpan } from "@server/platform/telemetry/telemetry.service";
import { createLogger } from "@server/shared/logger/logger.service";

import { saveSecurityArtifact } from "./security-artifacts";
import { createSecurityAgent } from "./security-agent";

import type { ModelConfig } from "@server/modules/ai-models/ai-models.service";
import type { SecurityAgentCallbacks, SecurityAgentResult } from "./security-agent";

const log = createLogger("security-worker");
const skillVersion = "hack-skills";
const active = new Map<string, { controller: AbortController; promise: Promise<void> }>();
let timer: NodeJS.Timeout | null = null;
let pumpTask: Promise<void> | undefined;
let started = false;
let stopping = false;
let fatalHandler: ((error: unknown) => void) | undefined;
const failures = new Set<unknown>();

function resolveTargetModel(target: {
  defaultAIModelId: string | null;
}): Promise<ModelConfig> {
  if (target.defaultAIModelId) {
    return loadActiveModelConfig(target.defaultAIModelId).then((model) => {
      if (!model) throw new Error("目标选择的模型不存在或已经停用");
      return model;
    });
  }
  return loadGlobalDefaultModel().then(resolveGlobalModelConfig);
}

function recordExecutionEvent(
  ticketId: string,
  executionId: string,
  type: string,
  message: string,
  data?: unknown,
) {
  return createSecurityEvent({
    ticketId,
    executionId,
    type,
    message,
    ...(data === undefined ? {} : { data }),
  }).then(() => undefined);
}

function recordFinding(
  ticketId: string,
  executionId: string,
  input: Parameters<SecurityAgentCallbacks["recordFinding"]>[0],
) {
  return prisma.securityFinding.upsert({
    where: { ticketId_fingerprint: { ticketId, fingerprint: input.fingerprint } },
    update: {
      executionId,
      category: input.category ?? null,
      severity: input.severity,
      confidence: input.confidence,
      title: input.title,
      description: input.description,
      evidence: input.evidence,
      remediation: input.remediation,
    },
    create: {
      ticketId,
      executionId,
      fingerprint: input.fingerprint,
      category: input.category ?? null,
      severity: input.severity,
      confidence: input.confidence,
      title: input.title,
      description: input.description,
      evidence: input.evidence,
      remediation: input.remediation,
    },
  }).then(() => publishSecurityTicketChanged(ticketId, { fingerprint: input.fingerprint }));
}

function saveReportArtifact(
  ticketId: string,
  executionId: string,
  filename: string,
  type: string,
  content: string,
  mimeType: string,
) {
  return saveSecurityArtifact({
    artifactRoot: securityConfig.artifactsRoot,
    ticketId,
    executionId,
    filename,
    data: content,
  }).then((metadata) => prisma.securityArtifact.create({
    data: {
      ticketId,
      executionId,
      type,
      filename: metadata.filename,
      storagePath: metadata.storagePath,
      mimeType: metadata.mimeType || mimeType,
      sha256: metadata.sha256,
      sizeBytes: metadata.sizeBytes,
    },
  }));
}

function loadReportTicket(ticketId: string) {
  return prisma.securityTicket.findUniqueOrThrow({
    where: { id: ticketId },
    include: {
      target: true,
      findings: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      traffic: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      artifacts: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          type: true,
          filename: true,
          mimeType: true,
          sha256: true,
          sizeBytes: true,
        },
      },
    },
  });
}

function writeReports(
  ticketId: string,
  executionId: string,
  summary: string,
  riskScore: number,
  narrative: string,
  status: string,
  error: string | null,
) {
  return loadReportTicket(ticketId).then((ticket) => {
    const reportTicket = {
      ...ticket,
      target: {
        ...ticket.target,
        scopeDomains: Array.isArray(ticket.target.scopeDomains)
          ? ticket.target.scopeDomains.filter((value): value is string => typeof value === "string")
          : [],
      },
      status,
      summary,
      report: [narrative, error ? `## 执行错误\n\n${error}` : ""].filter(Boolean).join("\n\n"),
      riskScore,
      finishedAt: new Date(),
    };
    const markdown = buildSecurityReport(reportTicket);
    const html = buildSecurityReportHtml(reportTicket);
    return saveReportArtifact(ticketId, executionId, "report.md", "report", markdown, "text/markdown")
      .then(() => saveReportArtifact(ticketId, executionId, "report.html", "report", html, "text/html"))
      .then(() => ({ markdown, narrative: reportTicket.report }));
  });
}

function notifyTicket(
  ticketId: string,
  target: { dingtalkRobotId: string | null; name: string },
  summary: string,
  riskScore: number,
  findingCount: number,
) {
  if (!target.dingtalkRobotId) return Promise.resolve();
  return loadDingtalkConfig(target.dingtalkRobotId).then((config) => {
    const baseUrl = (process.env.APP_PUBLIC_URL ?? "http://localhost:8787").replace(/\/$/, "");
    const link = `${baseUrl}/security/tickets/${ticketId}`;
    return sendDingtalkNotification(
      config,
      `安全测试完成：${target.name}`,
      [
        `### 安全测试完成：${target.name}`,
        "",
        `- 风险评分：${riskScore}`,
        `- 发现数量：${findingCount}`,
        `- 摘要：${summary}`,
        `- 详情：[打开工单](${link})`,
      ].join("\n"),
    );
  });
}

function finishSuccess(
  ticketId: string,
  executionId: string,
  model: ModelConfig,
  result: SecurityAgentResult,
  target: { dingtalkRobotId: string | null; name: string },
) {
  return writeReports(ticketId, executionId, result.summary, result.riskScore, result.report, "completed", null)
    .then((report) => finishSecurityTicket(ticketId, {
      status: "completed",
      summary: result.summary,
      riskScore: result.riskScore,
      report: report.narrative,
      modelProvider: model.provider,
      modelId: model.modelId,
      skillVersion,
    }).then(() => finishSecurityExecution(executionId, {
      status: "completed",
      rawResult: {
        summary: result.summary,
        riskScore: result.riskScore,
        reportLength: report.markdown.length,
      },
    })).then(() => recordExecutionEvent(ticketId, executionId, "execution.completed", "安全测试执行完成")))
    .then(() => prisma.securityFinding.count({ where: { ticketId } }))
    .then((findingCount) => notifyTicket(ticketId, target, result.summary, result.riskScore, findingCount)
      .catch((error: unknown) => recordExecutionEvent(
        ticketId,
        executionId,
        "notification.error",
        "钉钉通知发送失败",
        { error: error instanceof Error ? error.message : String(error) },
      )));
}

function finishFailure(
  ticketId: string,
  executionId: string,
  model: ModelConfig | null,
  error: Error,
  status: "failed" | "cancelled" | "interrupted",
) {
  return writeReports(ticketId, executionId, "安全测试未正常完成", 0, "", status, error.message)
    .then((report) => finishSecurityTicket(ticketId, {
      status,
      error: error.message,
      summary: "安全测试未正常完成",
      riskScore: 0,
      report: report.narrative,
      modelProvider: model?.provider ?? null,
      modelId: model?.modelId ?? null,
      skillVersion,
    }))
    .then(() => finishSecurityExecution(executionId, {
      status,
      error: error.message,
      rawResult: { error: error.message },
    }))
    .then(() => recordExecutionEvent(ticketId, executionId, "execution.failed", error.message));
}

function failureStatus(signal: AbortSignal): "failed" | "cancelled" | "interrupted" {
  const message = signal.reason instanceof Error ? signal.reason.message : String(signal.reason ?? "");
  if (message.includes("关闭")) return "interrupted";
  if (message.includes("取消")) return "cancelled";
  return "failed";
}

function executeTicket(ticketId: string, signal: AbortSignal): Promise<void> {
  let executionId = "";
  let modelConfig: ModelConfig | null = null;
  let secrets: string[] = [];

  return withSpan("security.ticket.run", { "security.ticket.id": ticketId }, () => prisma.securityTicket.findUniqueOrThrow({
    where: { id: ticketId },
    include: { target: true },
  }).then((ticket) => {
    if (ticket.status !== "running") throw new Error("安全工单尚未领取或已经结束");
    if (!ticket.target.isActive) throw new Error("安全测试目标已经停用");
    if (ticket.target.authorizedUntil.getTime() <= Date.now()) throw new Error("安全测试授权已经到期");

    return createSecurityExecution({ ticketId }).then((execution) => {
      executionId = execution.id;
      return recordExecutionEvent(ticketId, execution.id, "execution.started", "安全测试执行开始")
        .then(() => resolveTargetModel(ticket.target))
        .then((model) => {
          modelConfig = model;
          secrets = [model.apiKey];
          return prisma.securityIdentity.findMany({
            where: { targetId: ticket.targetId, isActive: true },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          }).then((identities) => identities.map((identity) => {
            const password = decryptSecret(identity.secretCiphertext);
            secrets.push(password);
            return {
              id: identity.id,
              name: identity.name,
              role: identity.role,
              username: identity.username,
              password,
              isActive: identity.isActive,
            };
          }));
        })
        .then((identities) => {
          if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("安全测试已经取消");
          const callbacks: SecurityAgentCallbacks = {
            recordTraffic: (input) => prisma.securityTraffic.create({
              data: {
                ticketId,
                executionId,
                method: input.method,
                url: input.url,
                statusCode: input.statusCode,
                requestHeaders: input.requestHeaders as Prisma.InputJsonValue,
                ...(input.responseHeaders ? { responseHeaders: input.responseHeaders as Prisma.InputJsonValue } : {}),
                bodyPreview: input.bodyPreview,
                contentHash: input.contentHash,
                durationMs: input.durationMs,
              },
            }).then(() => publishSecurityTicketChanged(ticketId)),
            recordArtifact: (input) => prisma.securityArtifact.create({
              data: {
                ticketId,
                executionId,
                type: input.type,
                filename: input.filename,
                storagePath: input.storagePath,
                mimeType: input.mimeType,
                sha256: input.sha256,
                sizeBytes: input.sizeBytes,
              },
            }).then(() => publishSecurityTicketChanged(ticketId)),
            recordFinding: (input) => recordFinding(ticketId, executionId, input),
            finish: () => undefined,
            recordEvent: (input) => recordExecutionEvent(
              input.ticketId,
              input.executionId,
              input.type,
              input.message,
              input.data,
            ),
          };

          return createSecurityAgent({
            ticketId,
            executionId,
            target: {
              name: ticket.target.name,
              baseUrl: ticket.target.baseUrl,
              scopeDomains: Array.isArray(ticket.target.scopeDomains)
                ? ticket.target.scopeDomains.filter((value): value is string => typeof value === "string")
                : [],
              authorizationOwner: ticket.target.authorizationOwner,
              authorizationReference: ticket.target.authorizationReference,
              authorizedUntil: ticket.target.authorizedUntil,
              maxDurationMinutes: ticket.target.maxDurationMinutes,
            },
            identities,
            modelConfig: modelConfig!,
            artifactRoot: securityConfig.artifactsRoot,
            callbacks,
            signal,
          }).then((result) => prisma.securityExecution.update({
            where: { id: executionId },
            data: { agentSessionId: result.sessionId },
          }).then(() => finishSuccess(ticketId, executionId, modelConfig!, result, {
            name: ticket.target.name,
            dingtalkRobotId: ticket.target.dingtalkRobotId,
          })));
        });
    });
  })).catch((error: unknown) => {
    const message = redactSecrets(error instanceof Error ? error.message : String(error), secrets);
    const safeError = new Error(message);
    const status = failureStatus(signal);
    if (!executionId) {
      return finishSecurityTicket(ticketId, {
        status,
        error: message,
        summary: "安全测试未能开始",
        riskScore: 0,
        modelProvider: modelConfig?.provider ?? null,
        modelId: modelConfig?.modelId ?? null,
        skillVersion,
      }).then(() => {
        throw new SecurityExecutionError(message);
      });
    }
    return finishFailure(ticketId, executionId, modelConfig, safeError, status).then(() => {
      throw new SecurityExecutionError(message);
    });
  });
}

function pump(): Promise<void> {
  if (pumpTask) return pumpTask;
  pumpTask = claimNextSecurityTicket().then((ticket) => {
    if (!ticket || stopping) return;
    const controller = new AbortController();
    const cancelPoll = setInterval(() => {
      prisma.securityTicket.findUnique({
        where: { id: ticket.id },
        select: { status: true },
      }).then((current) => {
        if (current?.status === "cancelling") controller.abort(new Error("用户取消安全测试"));
      }).catch((error: unknown) => {
        controller.abort(error instanceof Error ? error : new Error("读取安全工单状态失败"));
      });
    }, 2_000);
    cancelPoll.unref();
    const promise = executeTicket(ticket.id, controller.signal).catch((error: unknown) => {
      if (!(error instanceof SecurityExecutionError)) throw error;
      log.warn("安全工单执行结束", { ticketId: ticket.id, error: error.message });
    }).finally(() => {
      clearInterval(cancelPoll);
      active.delete(ticket.id);
      if (!stopping) return pump();
    });
    active.set(ticket.id, { controller, promise });
    return promise;
  }).finally(() => {
    pumpTask = undefined;
  });
  return pumpTask;
}

function recoverWorkerState(): Promise<void> {
  return prisma.securityExecution.findMany({
    where: { status: "running" },
    select: { id: true },
  }).then((executions) => prisma.$transaction([
    prisma.securityExecution.updateMany({
      where: { id: { in: executions.map((execution) => execution.id) } },
      data: { status: "interrupted", finishedAt: new Date(), error: "安全测试执行进程已经中断" },
    }),
    prisma.securityTicket.updateMany({
      where: { status: { in: ["running", "cancelling"] } },
      data: { status: "interrupted", finishedAt: new Date(), error: "安全测试执行进程已经中断" },
    }),
  ])).then(() => prisma.securityTicket.findMany({
    where: { status: "interrupted" },
    select: { id: true },
  })).then((tickets) => tickets.forEach((ticket) => publishSecurityTicketChanged(ticket.id)));
}

function verifyRuntime(): Promise<void> {
  const checks = [
    access(securityConfig.agentBrowserBin, constants.X_OK),
    access(path.join(securityConfig.skillsRoot, "hack", "SKILL.md"), constants.R_OK),
    access(securityConfig.actionPolicyPath, constants.R_OK),
  ];
  const browser = process.env.AGENT_BROWSER_EXECUTABLE_PATH?.trim();
  if (browser) checks.push(access(browser, constants.X_OK));
  return Promise.all(checks).then(() => undefined);
}

function failWorker(error: unknown): void {
  failures.add(error);
  stopping = true;
  if (timer) clearInterval(timer);
  timer = null;
  log.error("安全测试执行器已经停止", { error: error instanceof Error ? error.message : String(error) });
  fatalHandler?.(error);
}

export function startSecurityWorker(onFailure?: (error: unknown) => void): Promise<void> {
  if (started) return Promise.reject(new Error("安全测试执行器已经启动"));
  started = true;
  stopping = false;
  failures.clear();
  fatalHandler = onFailure;
  return verifyRuntime().then(recoverWorkerState).then(() => {
    if (stopping) throw new Error("安全测试执行器启动已经取消");
    timer = setInterval(() => {
      if (!stopping) void pump().catch(failWorker);
    }, 1_000);
    return pump();
  }).catch((error: unknown) => {
    started = false;
    failWorker(error);
    throw error;
  });
}

export function stopSecurityWorker(): Promise<void> {
  stopping = true;
  if (timer) clearInterval(timer);
  timer = null;
  for (const item of active.values()) {
    item.controller.abort(new Error("安全测试执行器正在关闭"));
  }
  return Promise.allSettled([pumpTask ?? Promise.resolve(), ...Array.from(active.values(), (item) => item.promise)])
    .then((results) => {
      for (const result of results) if (result.status === "rejected") failures.add(result.reason);
      if (failures.size) throw new AggregateError([...failures], "安全测试执行器关闭时存在错误");
    })
    .finally(() => {
      started = false;
      active.clear();
    });
}

class SecurityExecutionError extends Error {}
