import type { UIMessage } from 'ai';
import {
  ensureChatTitle,
  getSessionWithRepository,
  loadMessages,
  mergeIncomingUserMessageAtParent,
  mergePersistedMessages,
  saveMessages,
} from '../sessions/session-message-store.service';
import { publishSessionListChanged } from '../sessions/session-events.service';
import { createChatStream } from '../agent/chat-agent';
import { ensureVisibleAssistantReply } from '../agent/review-message';
import { createLogger } from '../../shared/logger/logger.service';

const log = createLogger('chat');

type ChatRequestBody = {
  sessionId?: string;
  messages?: UIMessage[];
  parentMessageId?: string | null;
};

type ChatStreamResult =
  | { kind: 'missing-session-id' }
  | { kind: 'missing-session' }
  | { kind: 'running' }
  | {
      kind: 'ready';
      messages: UIMessage[];
      stream: Awaited<ReturnType<typeof createChatStream>>;
      onEnd: (finalMessages: UIMessage[]) => Promise<void>;
    }
  | { kind: 'failed'; message: string };

export async function prepareChatStream(body: ChatRequestBody): Promise<ChatStreamResult> {
  const sessionId = body.sessionId;
  const incomingMessages = body.messages ?? [];
  const parentMessageId = typeof body.parentMessageId === 'string' ? body.parentMessageId : null;
  if (!sessionId) return { kind: 'missing-session-id' };

  const session = await getSessionWithRepository(sessionId);
  if (!session) return { kind: 'missing-session' };
  // 审查进行中禁止追问：webhook 审查（run-review）与本路由都会整组覆盖落库，
  // 并发写会互相清除对方消息，造成不可恢复的丢失。等审查完成再追问。
  if (session.status === 'running') return { kind: 'running' };

  const messages = mergeIncomingUserMessageAtParent(await loadMessages(sessionId), incomingMessages, parentMessageId);

  try {
    const stream = await createChatStream({ session, messages });
    return {
      kind: 'ready',
      messages,
      stream,
      onEnd: async (finalMessages) => {
        const visibleMessages = ensureVisibleAssistantReply(mergePersistedMessages(messages, finalMessages));
        await saveMessages(sessionId, visibleMessages);
        await ensureChatTitle(sessionId, visibleMessages);
        publishSessionListChanged();
      },
    };
  } catch (err) {
    log.error(`创建对话流失败 session=${sessionId}`, err);
    return { kind: 'failed', message: err instanceof Error ? err.message : '对话创建失败' };
  }
}
