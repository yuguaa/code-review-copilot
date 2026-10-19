import { Prisma } from "@prisma/client";
import { HTTPException } from "hono/http-exception";

import { prisma } from "@server/infrastructure/prisma/prisma.service";

import { securityEventInput } from "./security-input";

import type { SecurityEvent } from "@prisma/client";

export type SecurityTicketEvent = {
  id?: string;
  ticketId: string;
  executionId: string | null;
  type: string;
  message: string;
  data: Prisma.JsonValue | null;
  createdAt: Date | string;
};

type Client = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  ready: boolean;
  pending: SecurityTicketEvent[];
  close: () => void;
};

const maxPendingEvents = 128;
const heartbeatIntervalMs = 15_000;
const encoder = new TextEncoder();
const clients = new Map<string, Set<Client>>();

export function toSecurityTicketEvent(event: SecurityEvent): SecurityTicketEvent {
  return {
    id: event.id,
    ticketId: event.ticketId,
    executionId: event.executionId,
    type: event.type,
    message: event.message,
    data: event.data,
    createdAt: event.createdAt,
  };
}

export function subscribeSecurityTicketEvents(
  ticketId: string,
  signal?: AbortSignal,
  loadInitialEvents?: () => Promise<SecurityTicketEvent[]>,
): ReadableStream<Uint8Array> {
  const ticketClients = clients.get(ticketId) ?? new Set<Client>();
  clients.set(ticketId, ticketClients);
  let client: Client | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

  const closeClient = (controller: ReadableStreamDefaultController<Uint8Array>, cancelled = false) => {
    if (!client) return;
    const current = client;
    client = null;
    ticketClients.delete(current);
    if (ticketClients.size === 0 && clients.get(ticketId) === ticketClients) clients.delete(ticketId);
    signal?.removeEventListener("abort", abortClient);
    if (heartbeat) clearInterval(heartbeat);
    if (!cancelled) controller.close();
  };
  const abortClient = () => {
    if (!client) return;
    closeClient(client.controller);
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      if (signal?.aborted) {
        if (ticketClients.size === 0 && clients.get(ticketId) === ticketClients) clients.delete(ticketId);
        controller.close();
        return;
      }
      client = {
        controller,
        ready: !loadInitialEvents,
        pending: [],
        close: () => closeClient(controller),
      };
      ticketClients.add(client);
      controller.enqueue(encoder.encode(": connected\n\n"));
      signal?.addEventListener("abort", abortClient, { once: true });
      heartbeat = setInterval(() => {
        if (client?.ready && client.pending.length === 0) {
          try {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          } catch {
            closeClient(controller);
          }
        }
      }, heartbeatIntervalMs);
      heartbeat.unref();

      if (!loadInitialEvents) return;
      loadInitialEvents().then((events) => {
        if (!client || client.controller !== controller) return;
        const initialIds = new Set(events.flatMap((event) => event.id ? [event.id] : []));
        const pending = client.pending.filter((event) => !event.id || !initialIds.has(event.id));
        client.pending = [];
        client.ready = true;
        [...events, ...pending].forEach((event) => enqueue(controller, event));
      }).catch((error: unknown) => {
        if (!client || client.controller !== controller) return;
        controller.error(error);
        closeClient(controller, true);
      });
    },
    cancel() {
      if (streamController) closeClient(streamController, true);
    },
  });
}

export function publishSecurityTicketEvent(event: SecurityTicketEvent): void {
  const ticketClients = clients.get(event.ticketId);
  if (!ticketClients?.size) return;

  for (const client of ticketClients) {
    if (!client.ready) {
      client.pending.push(event);
      if (client.pending.length >= maxPendingEvents) client.close();
      continue;
    }
    if (!enqueue(client.controller, event)) client.close();
  }
}

export function publishSecurityTicketChanged(ticketId: string, data?: Prisma.JsonValue): void {
  publishSecurityTicketEvent({
    ticketId,
    executionId: null,
    type: "changed",
    message: "工单状态已经更新",
    data: data ?? null,
    createdAt: new Date(),
  });
}

export function createSecurityEvent(body: unknown) {
  const input = securityEventInput.parse(body);
  return prisma.securityTicket.findUniqueOrThrow({ where: { id: input.ticketId }, select: { id: true } })
    .then(() => input.executionId
      ? prisma.securityExecution.findFirst({
        where: { id: input.executionId, ticketId: input.ticketId },
        select: { id: true },
      }).then((execution) => {
        if (!execution) throw new HTTPException(400, { message: "执行记录不属于当前工单" });
      })
      : Promise.resolve())
    .then(() => prisma.securityEvent.create({
      data: {
        ticketId: input.ticketId,
        executionId: input.executionId ?? null,
        type: input.type,
        message: input.message,
        ...(input.data === undefined ? {} : {
          data: input.data === null ? Prisma.JsonNull : input.data as Prisma.InputJsonValue,
        }),
      },
    }))
    .then((event) => {
      publishSecurityTicketEvent(toSecurityTicketEvent(event));
      return event;
    });
}

function enqueue(controller: ReadableStreamDefaultController<Uint8Array>, event: SecurityTicketEvent): boolean {
  if (!/^[A-Za-z0-9_.:-]+$/.test(event.type)) throw new Error("安全事件类型格式无效");
  try {
    const id = event.id ? `id: ${event.id}\n` : "";
    controller.enqueue(encoder.encode(`${id}event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
    return true;
  } catch {
    return false;
  }
}
