import type { UIMessage } from 'ai';
import type { SessionMessageTree } from './session-message-store.service';

type SessionMessagePayload = Pick<
  SessionMessageTree,
  'messages' | 'messageTree' | 'activeLeafMessageId' | 'activePathIds'
>;

type SessionEvent =
  | ({ type: 'messages'; messages: UIMessage[] } & Partial<Omit<SessionMessagePayload, 'messages'>>)
  | { type: 'status'; status: string }
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

export function subscribeSessionEvents(sessionId: string, signal?: AbortSignal): ReadableStream<Uint8Array> {
  const sessionClients = clients.get(sessionId) ?? new Set<Client>();
  clients.set(sessionId, sessionClients);
  return createClientStream(sessionClients, signal, () => {
    if (sessionClients.size === 0) clients.delete(sessionId);
  });
}

export function publishSessionMessages(
  sessionId: string,
  messagesOrPayload: UIMessage[] | SessionMessagePayload,
): void {
  const payload = Array.isArray(messagesOrPayload) ? { messages: messagesOrPayload } : messagesOrPayload;
  publishSessionEvent(sessionId, { type: 'messages', ...payload });
}

export function publishSessionStatus(sessionId: string, status: string): void {
  publishSessionEvent(sessionId, { type: 'status', status });
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
): ReadableStream<Uint8Array> {
  let client: Client | null = null;
  let close: (() => void) | null = null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const closeClient = () => {
        if (!client) return;
        const closingClient = client;
        client = null;
        clientSet.delete(closingClient);
        if (clientSet.size === 0) onEmpty?.();
        signal?.removeEventListener('abort', closeClient);
        try {
          controller.close();
        } catch {
          // 连接可能已由浏览器关闭。
        }
      };
      client = { controller, pending: [], close: closeClient };
      close = closeClient;
      clientSet.add(client);
      controller.enqueue(encoder.encode(': connected\n\n'));

      signal?.addEventListener('abort', closeClient, { once: true });
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
      close?.();
    },
  });
}

function publishClients(clientSet: Set<Client>, event: { type: string }): void {
  if (!clientSet.size) return;

  const chunk = encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  for (const client of clientSet) {
    if (client.pending.length > 0 || (client.controller.desiredSize ?? 0) <= 0) {
      if (event.type === 'messages') {
        client.pending = client.pending.filter((pending) => pending.type !== 'messages');
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
