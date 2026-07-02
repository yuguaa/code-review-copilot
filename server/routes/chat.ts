import { Hono } from 'hono';
import { parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema, type UIMessage } from 'ai';
import { ensureChatTitle, getSessionWithRepository, loadMessages, mergeIncomingUserMessage, mergeStreamingMessage, saveMessages } from '../lib/chat-store';
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
  let body: { sessionId?: string; messages?: UIMessage[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: '请求体无效' }, 400);
  }

  const sessionId = body.sessionId;
  const incomingMessages = body.messages ?? [];
  if (!sessionId) return c.json({ error: '缺少 sessionId' }, 400);

  const session = await getSessionWithRepository(sessionId);
  if (!session) return c.json({ error: '会话不存在' }, 404);
  // 审查进行中禁止追问：webhook 审查（run-review）与本路由都会整组覆盖落库，
  // 并发写会互相清除对方消息，造成不可恢复的丢失。等审查完成再追问。
  if (session.status === 'running') {
    return c.json({ error: '本次审查正在进行中，请等待审查完成后再追问。' }, 409);
  }

  const messages = mergeIncomingUserMessage(await loadMessages(sessionId), incomingMessages);

  let result: Awaited<ReturnType<typeof createChatStream>>;
  try {
    result = await createChatStream({ session, messages });
  } catch (err) {
    log.error(`创建对话流失败 session=${sessionId}`, err);
    return c.json({ error: err instanceof Error ? err.message : '对话创建失败' }, 500);
  }

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    // 把真实错误透传给前端 toast，而不是默认的 "An error occurred."
    onError: (error) => (error instanceof Error ? error.message : String(error)),
    consumeSseStream: ({ stream }) => {
      consumeChatStream(sessionId, messages, stream);
    },
  });
});

function consumeChatStream(
  sessionId: string,
  initialMessages: UIMessage[],
  stream: ReadableStream<string>,
): void {
  const parsedStream = parseJsonEventStream({
    stream: stream.pipeThrough(new TextEncoderStream()),
    schema: uiMessageChunkSchema,
  });
  const chunkStream = parsedStream.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        if (!chunk.success) throw chunk.error;
        controller.enqueue(chunk.value);
      },
    }),
  );

  void (async () => {
    // 交互追问由前端 useChat 独占流式渲染；服务端只负责把最终结果落库，
    // 不再逐 chunk 回显，避免两个来源双写同一会话造成重复/闪跳。
    let finalMessages = initialMessages;
    for await (const message of readUIMessageStream<UIMessage>({ stream: chunkStream })) {
      finalMessages = mergeStreamingMessage(initialMessages, message);
    }
    finalMessages = ensureVisibleAssistantReply(finalMessages);
    await saveMessages(sessionId, finalMessages);
    await ensureChatTitle(sessionId, finalMessages);
    publishSessionListChanged();
  })().catch((err) => log.error(`消费追问流失败 session=${sessionId}`, err));
}
