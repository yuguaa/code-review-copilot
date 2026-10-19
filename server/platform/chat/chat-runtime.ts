import { HTTPException } from "hono/http-exception";

const activeSessions = new Map<string, { abort?: () => void; done: Promise<void> }>();
let accepting = true;

export function isChatSessionActive(sessionId: string): boolean {
  return activeSessions.has(sessionId);
}

export function claimChatSession(sessionId: string, abort?: () => void): () => void {
  if (!accepting) throw new HTTPException(503, { message: "服务正在关闭" });
  if (activeSessions.has(sessionId)) throw new HTTPException(409, { message: "当前会话正在生成回答" });
  let complete: () => void;
  const done = new Promise<void>((resolve) => { complete = resolve; });
  const current = { abort, done };
  activeSessions.set(sessionId, current);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (activeSessions.get(sessionId) === current) activeSessions.delete(sessionId);
    complete();
  };
}

export function stopChatSessions(): Promise<void> {
  accepting = false;
  const current = [...activeSessions.values()];
  for (const session of current) session.abort?.();
  return Promise.all(current.map((session) => session.done)).then(() => undefined);
}

export function stopChatSession(sessionId: string): Promise<void> {
  const current = activeSessions.get(sessionId);
  if (!current?.abort) throw new HTTPException(409, { message: "当前没有生成中的回答" });
  current.abort();
  return current.done;
}
