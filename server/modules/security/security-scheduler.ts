import { prisma } from "@server/infrastructure/prisma/prisma.service";
import { createLogger } from "@server/shared/logger/logger.service";

import { securityActiveTicketStatuses } from "./security-input";
import { securityNextScheduledAt } from "./security-targets.service";
import { publishSecurityTicketChanged } from "./security-tickets.service";

type DueTarget = {
  id: string;
  scheduleIntervalMinutes: number;
};

const schedulerIntervalMs = 60_000;
const log = createLogger("security-scheduler");
let timer: NodeJS.Timeout | null = null;
let task: Promise<void> | null = null;

export function runDueSecuritySchedules(now = new Date()): Promise<string[]> {
  const createdTicketIds: string[] = [];
  return prisma.$transaction((transaction) => transaction.$queryRaw<DueTarget[]>`
    SELECT target.id, target."scheduleIntervalMinutes"
    FROM security_targets AS target
    WHERE target."scheduleEnabled" = true
      AND target."isActive" = true
      AND target."authorizedUntil" > ${now}
      AND target."nextScheduledAt" IS NOT NULL
      AND target."nextScheduledAt" <= ${now}
    ORDER BY target."nextScheduledAt", target.id
    FOR UPDATE OF target SKIP LOCKED
  `.then((targets) => targets.reduce<Promise<void>>((sequence, target) => sequence.then(() => (
    transaction.securityTicket.findFirst({
      where: { targetId: target.id, status: { in: [...securityActiveTicketStatuses] } },
      select: { id: true },
    }).then((busy) => {
      if (busy) return;
      return transaction.securityTicket.create({
        data: {
          targetId: target.id,
          triggerType: "scheduled",
          status: "queued",
          requestedAt: now,
        },
        select: { id: true },
      }).then((ticket) => transaction.securityTarget.update({
        where: { id: target.id },
        data: {
          lastScheduledAt: now,
          nextScheduledAt: securityNextScheduledAt(now, target.scheduleIntervalMinutes),
        },
      }).then(() => {
        createdTicketIds.push(ticket.id);
      }));
    })
  )), Promise.resolve()))).then(() => {
    createdTicketIds.forEach((ticketId) => publishSecurityTicketChanged(ticketId));
    return createdTicketIds;
  });
}

export function startSecurityScheduler(): void {
  if (timer) return;
  const run = () => {
    if (task) return;
    task = runDueSecuritySchedules().then(() => undefined).catch((error: unknown) => {
      log.error("安全测试调度执行失败", { error: error instanceof Error ? error.message : String(error) });
    }).finally(() => {
      task = null;
    });
  };
  timer = setInterval(run, schedulerIntervalMs);
  timer.unref();
  run();
}

export function stopSecurityScheduler(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  return task ?? Promise.resolve();
}
