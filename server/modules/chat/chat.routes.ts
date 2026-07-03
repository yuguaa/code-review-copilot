import { Hono } from 'hono';
import type { UIMessage } from 'ai';
import { randomUUID } from 'node:crypto';
import { prepareChatStream } from './chat.service';

export const chatRoutes = new Hono();

/**
 * 对话入口：所有页面追问（审查会话与普通会话）都走对话 agent。
 * webhook 首轮审查不经过这里，见 run-review.ts。
 */
chatRoutes.post('/', async (c) => {
  let body: { sessionId?: string; messages?: UIMessage[]; parentMessageId?: string | null };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: '请求体无效' }, 400);
  }

  const result = await prepareChatStream(body);
  if (result.kind === 'missing-session-id') return c.json({ error: '缺少 sessionId' }, 400);
  if (result.kind === 'missing-session') return c.json({ error: '会话不存在' }, 404);
  if (result.kind === 'running') {
    return c.json({ error: '本次审查正在进行中，请等待审查完成后再追问。' }, 409);
  }
  if (result.kind === 'failed') return c.json({ error: result.message }, 500);

  return result.stream.toUIMessageStreamResponse({
    originalMessages: result.messages,
    generateMessageId: randomUUID,
    // 把真实错误透传给前端 toast，而不是默认的 "An error occurred."
    onError: (error) => (error instanceof Error ? error.message : String(error)),
    onEnd: async ({ messages: finalMessages }) => {
      await result.onEnd(finalMessages);
    },
  });
});
