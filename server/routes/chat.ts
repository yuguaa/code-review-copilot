import { Hono } from 'hono';
import type { UIMessage } from 'ai';
import { randomUUID } from 'node:crypto';
import {
  ensureChatTitle,
  getSessionWithRepository,
  loadMessages,
  mergeIncomingUserMessageAtParent,
  mergePersistedMessages,
  saveMessages,
} from '../lib/chat-store';
import { publishSessionListChanged } from '../lib/session-events';
import { createChatStream } from '../agent/chat-agent';
import { ensureVisibleAssistantReply } from '../agent/review-message';
import { createLogger } from '../lib/logger';

const log = createLogger('chat');
export const chatRoutes = new Hono();

/**
 * 对话入口：所有页面追问（审查会话与普通会话）都走对话 agent。
 * 前端 useChat 以 { sessionId, messages: UIMessage[] } POST 过来；
 * streamText 直接对话（模型自主决定是否用只读工具），UI message 流式回传，onFinish 落库。
 * webhook 首轮审查不经过这里，见 run-review.ts。
 */
chatRoutes.post('/', async (c) => {
  let body: { sessionId?: string; messages?: UIMessage[]; parentMessageId?: string | null };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: '请求体无效' }, 400);
  }

  const sessionId = body.sessionId;
  const incomingMessages = body.messages ?? [];
  const parentMessageId = typeof body.parentMessageId === 'string' ? body.parentMessageId : null;
  if (!sessionId) return c.json({ error: '缺少 sessionId' }, 400);

  const session = await getSessionWithRepository(sessionId);
  if (!session) return c.json({ error: '会话不存在' }, 404);
  // 审查进行中禁止追问：webhook 审查（run-review）与本路由都会整组覆盖落库，
  // 并发写会互相清除对方消息，造成不可恢复的丢失。等审查完成再追问。
  if (session.status === 'running') {
    return c.json({ error: '本次审查正在进行中，请等待审查完成后再追问。' }, 409);
  }

  const messages = mergeIncomingUserMessageAtParent(await loadMessages(sessionId), incomingMessages, parentMessageId);

  let result: Awaited<ReturnType<typeof createChatStream>>;
  try {
    result = await createChatStream({ session, messages });
  } catch (err) {
    log.error(`创建对话流失败 session=${sessionId}`, err);
    return c.json({ error: err instanceof Error ? err.message : '对话创建失败' }, 500);
  }

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    generateMessageId: randomUUID,
    // 把真实错误透传给前端 toast，而不是默认的 "An error occurred."
    onError: (error) => (error instanceof Error ? error.message : String(error)),
    onEnd: async ({ messages: finalMessages }) => {
      const visibleMessages = ensureVisibleAssistantReply(mergePersistedMessages(messages, finalMessages));
      await saveMessages(sessionId, visibleMessages);
      await ensureChatTitle(sessionId, visibleMessages);
      publishSessionListChanged();
    },
  });
});
