import { Hono } from 'hono';
import type { UIMessage } from 'ai';
import { getSessionWithRepository, saveMessages } from '../lib/chat-store';
import { createReviewStream } from '../agent/review-agent';
import { createLogger } from '../lib/logger';

const log = createLogger('chat');
export const chatRoutes = new Hono();

/**
 * 对话入口：普通追问与审查首轮共用。
 * 前端 useChat 以 { sessionId, messages: UIMessage[] } POST 过来；
 * streamText 跑 agent loop，UI message 流式回传，onFinish 落库。
 */
chatRoutes.post('/', async (c) => {
  let body: { sessionId?: string; messages?: UIMessage[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: '请求体无效' }, 400);
  }

  const sessionId = body.sessionId;
  const messages = body.messages ?? [];
  if (!sessionId) return c.json({ error: '缺少 sessionId' }, 400);

  const session = await getSessionWithRepository(sessionId);
  if (!session) return c.json({ error: '会话不存在' }, 404);

  const result = await createReviewStream({ session, messages });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onFinish: ({ messages: finalMessages }) => {
      saveMessages(sessionId, finalMessages).catch((err) =>
        log.error(`保存会话消息失败 session=${sessionId}`, err),
      );
    },
  });
});
