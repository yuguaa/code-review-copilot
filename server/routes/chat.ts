import { Hono } from 'hono';
import { parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema, type UIMessage } from 'ai';
import { ensureChatTitle, getSessionWithRepository, mergeStreamingMessage, saveMessages } from '../lib/chat-store';
import { publishSessionListChanged, publishSessionMessages } from '../lib/session-events';
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

  let result: Awaited<ReturnType<typeof createReviewStream>>;
  try {
    result = await createReviewStream({ session, messages });
  } catch (err) {
    log.error(`创建审查流失败 session=${sessionId}`, err);
    return c.json({ error: err instanceof Error ? err.message : '审查流创建失败' }, 500);
  }

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
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
    let finalMessages = initialMessages;
    for await (const message of readUIMessageStream<UIMessage>({ stream: chunkStream })) {
      finalMessages = mergeStreamingMessage(initialMessages, message);
      publishSessionMessages(sessionId, finalMessages);
    }
    await saveMessages(sessionId, finalMessages);
    await ensureChatTitle(sessionId, finalMessages);
    publishSessionListChanged();
  })().catch((err) => log.error(`消费追问流失败 session=${sessionId}`, err));
}
