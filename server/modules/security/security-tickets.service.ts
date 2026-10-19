import { Prisma } from "@prisma/client";
import { HTTPException } from "hono/http-exception";

import { prisma } from "@server/infrastructure/prisma/prisma.service";
import {
  securityExecutionFinishInput,
  securityExecutionInput,
  securityScopeDomains,
  securityTerminalTicketStatuses,
  securityTicketFinishInput,
  securityTicketInput,
} from "./security-input";
import {
  createSecurityEvent,
  publishSecurityTicketChanged,
  toSecurityTicketEvent,
} from "./security-events.service";

const securityTargetSummarySelect = {
  id: true,
  name: true,
  baseUrl: true,
  repositoryId: true,
  scopeDomains: true,
  authorizationOwner: true,
  authorizationReference: true,
  authorizedUntil: true,
  scheduleEnabled: true,
  scheduleIntervalMinutes: true,
  nextScheduledAt: true,
  lastScheduledAt: true,
  isActive: true,
  maxDurationMinutes: true,
  defaultAIModelId: true,
  dingtalkRobotId: true,
} satisfies Prisma.SecurityTargetSelect;

const securityArtifactMetadataSelect = {
  id: true,
  ticketId: true,
  executionId: true,
  type: true,
  filename: true,
  mimeType: true,
  sha256: true,
  sizeBytes: true,
  createdAt: true,
} satisfies Prisma.SecurityArtifactSelect;

const securityTicketListSelect = {
  id: true,
  targetId: true,
  triggerType: true,
  status: true,
  requestedAt: true,
  startedAt: true,
  finishedAt: true,
  error: true,
  summary: true,
  riskScore: true,
  modelProvider: true,
  modelId: true,
  skillVersion: true,
  createdAt: true,
  updatedAt: true,
  target: { select: securityTargetSummarySelect },
} satisfies Prisma.SecurityTicketSelect;

const securityTicketDetailSelect = {
  ...securityTicketListSelect,
  report: true,
  executions: { orderBy: [{ startedAt: "asc" }, { id: "asc" }] },
  findings: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  traffic: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  artifacts: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: securityArtifactMetadataSelect },
  events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.SecurityTicketSelect;

const securityEventSelect = {
  id: true,
  ticketId: true,
  executionId: true,
  type: true,
  message: true,
  data: true,
  createdAt: true,
} satisfies Prisma.SecurityEventSelect;

type SecurityTicketListRecord = Prisma.SecurityTicketGetPayload<{ select: typeof securityTicketListSelect }>;
type SecurityTicketDetailRecord = Prisma.SecurityTicketGetPayload<{ select: typeof securityTicketDetailSelect }>;

export type SecurityTicketListItem = Omit<SecurityTicketListRecord, "target"> & {
  target: Omit<SecurityTicketListRecord["target"], "scopeDomains"> & { scopeDomains: string[] };
};

export type SecurityTicketDetail = Omit<SecurityTicketDetailRecord, "target"> & {
  target: Omit<SecurityTicketDetailRecord["target"], "scopeDomains"> & { scopeDomains: string[] };
};

export function listSecurityTickets(): Promise<SecurityTicketListItem[]> {
  return prisma.securityTicket.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: securityTicketListSelect,
  }).then((tickets) => tickets.map(toSecurityTicketListItem));
}

export function securityTicketExists(id: string): Promise<boolean> {
  return prisma.securityTicket.findUnique({ where: { id }, select: { id: true } }).then(Boolean);
}

export function getSecurityTicket(id: string): Promise<SecurityTicketDetail> {
  return prisma.securityTicket.findUniqueOrThrow({ where: { id }, select: securityTicketDetailSelect })
    .then(toSecurityTicketDetail);
}

export function createSecurityTicket(body: unknown) {
  const input = securityTicketInput.parse(body);
  return prisma.$transaction((transaction) => transaction.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM security_targets WHERE id = ${input.targetId} FOR UPDATE
  `.then((targets) => {
    if (!targets[0]) throw new HTTPException(404, { message: "安全测试目标不存在" });
    return transaction.securityTicket.create({
      data: { targetId: input.targetId, triggerType: "manual", status: "queued" },
    });
  }))
    .then((ticket) => {
      publishSecurityTicketChanged(ticket.id);
      return ticket;
    });
}

export function cancelSecurityTicket(id: string) {
  const now = new Date();
  return prisma.$transaction((transaction) => transaction.securityTicket.findUniqueOrThrow({ where: { id } })
    .then((ticket) => {
      if (ticket.status === "queued") {
        return transaction.securityTicket.update({
          where: { id },
          data: { status: "cancelled", finishedAt: now },
        });
      }
      if (ticket.status === "running" || ticket.status === "cancelling") {
        return transaction.securityTicket.update({ where: { id }, data: { status: "cancelling" } });
      }
      throw new HTTPException(409, { message: "当前工单不能取消" });
    })).then((ticket) => {
      publishSecurityTicketChanged(ticket.id);
      return ticket;
    });
}

export function claimNextSecurityTicket() {
  const now = new Date();
  return prisma.$transaction((transaction) => transaction.$queryRaw<Array<{ id: string }>>`
    SELECT target.id
    FROM security_targets AS target
    WHERE target."isActive" = true
      AND target."authorizedUntil" > ${now}
      AND EXISTS (
        SELECT 1 FROM security_tickets AS ticket
        WHERE ticket."targetId" = target.id AND ticket.status = 'queued'
      )
      AND NOT EXISTS (
        SELECT 1 FROM security_tickets AS ticket
        WHERE ticket."targetId" = target.id AND ticket.status IN ('running', 'cancelling')
      )
    ORDER BY (
      SELECT MIN(ticket."createdAt") FROM security_tickets AS ticket
      WHERE ticket."targetId" = target.id AND ticket.status = 'queued'
    ), target.id
    FOR UPDATE OF target SKIP LOCKED
    LIMIT 1
  `.then((targets) => {
    const target = targets[0];
    if (!target) return null;
    return transaction.securityTicket.findFirst({
      where: { targetId: target.id, status: "queued" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }).then((queued) => {
      if (!queued) throw new Error("目标存在排队工单，但无法读取排队记录");
      return transaction.securityTicket.update({
        where: { id: queued.id },
        data: { status: "running", startedAt: now, finishedAt: null, error: null },
      });
    });
  })).then((ticket) => {
    if (!ticket) return null;
    publishSecurityTicketChanged(ticket.id);
    return ticket;
  });
}

export function finishSecurityTicket(id: string, body: unknown) {
  const input = securityTicketFinishInput.parse(body);
  return prisma.$transaction((transaction) => transaction.securityTicket.findUniqueOrThrow({ where: { id } })
    .then((ticket) => {
      if (securityTerminalTicketStatuses.includes(ticket.status as typeof securityTerminalTicketStatuses[number])) return ticket;
      const status = ticket.status === "cancelling" && input.status !== "interrupted" ? "cancelled" : input.status;
      return transaction.securityTicket.update({
        where: { id },
        data: {
          status,
          startedAt: ticket.startedAt ?? new Date(),
          finishedAt: new Date(),
          error: input.error,
          report: input.report,
          summary: input.summary,
          riskScore: input.riskScore,
          modelProvider: input.modelProvider,
          modelId: input.modelId,
          skillVersion: input.skillVersion,
        },
      });
    })).then((ticket) => {
      publishSecurityTicketChanged(ticket.id);
      return ticket;
    });
}

export function createSecurityExecution(body: unknown) {
  const input = securityExecutionInput.parse(body);
  return prisma.$transaction((transaction) => transaction.securityTicket.findUniqueOrThrow({
    where: { id: input.ticketId },
    select: { id: true },
  }).then(() => transaction.securityExecution.create({
    data: {
      ticketId: input.ticketId,
      agentSessionId: input.agentSessionId ?? null,
      traceId: input.traceId ?? null,
      status: "running",
    },
  }))).then((execution) => {
    publishSecurityTicketChanged(execution.ticketId);
    return execution;
  });
}

export function finishSecurityExecution(id: string, body: unknown) {
  const input = securityExecutionFinishInput.parse(body);
  return prisma.$transaction((transaction) => transaction.securityExecution.findUniqueOrThrow({ where: { id } })
    .then((execution) => {
      if (execution.finishedAt) return execution;
      return transaction.securityExecution.update({
        where: { id },
        data: {
          status: input.status,
          error: input.error,
          finishedAt: new Date(),
          ...(input.rawResult === undefined ? {} : {
            rawResult: input.rawResult === null ? Prisma.JsonNull : input.rawResult as Prisma.InputJsonValue,
          }),
        },
      });
    })).then((execution) => {
      publishSecurityTicketChanged(execution.ticketId);
      return execution;
    });
}

export function listSecurityTicketEvents(ticketId: string) {
  return prisma.securityTicket.findUniqueOrThrow({ where: { id: ticketId }, select: { id: true } })
    .then(() => prisma.securityEvent.findMany({
      where: { ticketId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: securityEventSelect,
    }))
    .then((events) => events.map(toSecurityTicketEvent));
}

export function getSecurityArtifactForRaw(id: string) {
  return prisma.securityArtifact.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      filename: true,
      storagePath: true,
      mimeType: true,
      sha256: true,
      sizeBytes: true,
    },
  });
}

export { createSecurityEvent, publishSecurityTicketChanged };

function toSecurityTicketListItem(ticket: SecurityTicketListRecord): SecurityTicketListItem {
  return {
    ...ticket,
    target: {
      ...ticket.target,
      scopeDomains: securityScopeDomains.parse(ticket.target.scopeDomains),
    },
  };
}

function toSecurityTicketDetail(ticket: SecurityTicketDetailRecord): SecurityTicketDetail {
  return {
    ...ticket,
    target: {
      ...ticket.target,
      scopeDomains: securityScopeDomains.parse(ticket.target.scopeDomains),
    },
  };
}
