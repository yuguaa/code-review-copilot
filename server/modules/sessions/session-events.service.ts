import type { UIMessage } from 'ai';
import type { SessionMessageTree } from './session-message-store.service';

type SessionMessagePayload = Pick<
  SessionMessageTree,
  'messages' | 'messageTree' | 'activeLeafMessageId' | 'activePathIds'
>;

type SessionEvent =
  | ({ type: 'messages'; messages: UIMessage[] } & Partial<Omit<SessionMessagePayload, 'messages'>>)
  | { type: 'status'; status: string }
  | { type: 'review-progress'; runId: string; message: string }
  | { type: 'review-error'; error: string };

type Client = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  pending: Array<{ type: string; chunk: Uint8Array }>;
  close: () => void;
};

const MAX_PENDING_EVENTS = 32;
const encoder = new TextEncoder();
const clients = new Map<string, Set<Client>>();
const listClients = new Set<Client>();
const latestProgress = new Map<string, Extract<SessionEvent, { type: 'review-progress' }>>();

export function subscribeSessionEvents(sessionId: string, signal?: AbortSignal): ReadableStream<Uint8Array> {
  const sessionClients = clients.get(sessionId) ?? new Set<Client>();
  clients.set(sessionId, sessionClients);
  return createClientStream(sessionClients, signal, () => {
    if (sessionClients.size === 0 && clients.get(sessionId) === sessionClients) clients.delete(sessionId);
  }, latestProgress.get(sessionId) ? [latestProgress.get(sessionId)!] : []);
}

export function publishSessionMessages(
  sessionId: string,
  messagesOrPayload: UIMessage[] | SessionMessagePayload,
): void {
  const payload = Array.isArray(messagesOrPayload) ? { messages: messagesOrPayload } : messagesOrPayload;
  publishSessionEvent(sessionId, { type: 'messages', ...payload });
}

export function publishSessionStatus(sessionId: string, status: string): void {
  if (!['queued', 'running', 'cancelling'].includes(status)) latestProgress.delete(sessionId);
  publishSessionEvent(sessionId, { type: 'status', status });
}

export function publishSessionProgress(sessionId: string, runId: string, message: string): void {
  const event = { type: 'review-progress' as const, runId, message };
  latestProgress.set(sessionId, event);
  publishSessionEvent(sessionId, event);
}

export function publishSessionError(sessionId: string, error: string): void {
  publishSessionEvent(sessionId, { type: 'review-error', error });
}

export function subscribeSessionListEvents(signal?: AbortSignal): ReadableStream<Uint8Array> {
  return createClientStream(listClients, signal);
}

export function publishSessionListChanged(): void {
  publishClients(listClients, { type: 'changed' });
}

function publishSessionEvent(sessionId: string, event: SessionEvent): void {
  const sessionClients = clients.get(sessionId);
  if (!sessionClients?.size) return;

  publishClients(sessionClients, event);
  if (sessionClients.size === 0) clients.delete(sessionId);
}

function createClientStream(
  clientSet: Set<Client>,
  signal?: AbortSignal,
  onEmpty?: () => void,
  initialEvents: SessionEvent[] = [],
): ReadableStream<Uint8Array> {
  let client: Client | null = null;
  let close: ((cancelled?: boolean) => void) | null = null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const abortClient = () => closeClient();
      const closeClient = (cancelled = false) => {
        if (!client) return;
        const closingClient = client;
        client = null;
        clientSet.delete(closingClient);
        if (clientSet.size === 0) onEmpty?.();
        signal?.removeEventListener('abort', abortClient);
        if (heartbeat) clearInterval(heartbeat);
        closingClient.pending.length = 0;
        if (!cancelled) controller.close();
      };
      client = { controller, pending: [], close: closeClient };
      close = closeClient;
      clientSet.add(client);
      if (signal?.aborted) {
        closeClient();
        return;
      }
      controller.enqueue(encoder.encode(': connected\n\n'));
      for (const event of initialEvents) controller.enqueue(encodeEvent(event));
      signal?.addEventListener('abort', abortClient, { once: true });
      heartbeat = setInterval(() => {
        if (client && !client.pending.length && (controller.desiredSize ?? 0) > 0) {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        }
      }, 15_000);
      heartbeat.unref();
    },
    pull(controller) {
      const pending = client?.pending.shift();
      if (!pending) return;
      try {
        controller.enqueue(pending.chunk);
      } catch {
        close?.();
      }
    },
    cancel() {
      close?.(true);
    },
  });
}

function publishClients(clientSet: Set<Client>, event: { type: string }): void {
  if (!clientSet.size) return;

  const chunk = encodeEvent(event);
  for (const client of clientSet) {
    if (client.pending.length > 0 || (client.controller.desiredSize ?? 0) <= 0) {
      if (event.type === 'messages' || event.type === 'review-progress') {
        client.pending = client.pending.filter((pending) => pending.type !== event.type);
      }
      if (client.pending.length >= MAX_PENDING_EVENTS) {
        client.close();
        continue;
      }
      client.pending.push({ type: event.type, chunk });
      continue;
    }
    try {
      client.controller.enqueue(chunk);
    } catch {
      client.close();
    }
  }
}

function encodeEvent(event: { type: string }): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}
