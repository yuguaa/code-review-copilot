import {
  getSessionWithRepository,
  loadMessages,
  mergeStreamingMessage,
  saveMessages,
} from '../sessions/session-message-store.service';
import { createReviewStream } from './review-agent';
import { ensureVisibleAssistantReply } from './review-message';
import { notifyReviewCompleted } from './review-notification';
import { createLogger } from '../../shared/logger/logger.service';
import { publishSessionMessages } from '../sessions/session-events.service';
import { readUIMessageStream, type UIMessage } from 'ai';
import {
  markReviewSessionCompleted,
  markReviewSessionFailed,
} from '../sessions/session-lifecycle.service';

const log = createLogger('run-review');

/**
 * 后台跑一次完整审查：加载会话与种子消息 → 跑主 agent → 流式落库 → 更新状态。
 * 由 webhook fire-and-forget 调用；自身吞掉异常并落 failed 状态。
 */
export async function runReviewSession(sessionId: string): Promise<void> {
  const session = await getSessionWithRepository(sessionId);
  if (!session) {
    log.error(`审查会话不存在：${sessionId}`);
    return;
  }

  try {
    const initial = await loadMessages(sessionId);
    const result = await createReviewStream({ session, messages: initial });
    let finalMessages = initial;

    const uiStream = result.toUIMessageStream({
      originalMessages: initial,
      onEnd: ({ messages }) => {
        finalMessages = messages;
      },
    });

    for await (const message of readUIMessageStream<UIMessage>({ stream: uiStream })) {
      finalMessages = mergeStreamingMessage(initial, message);
      publishSessionMessages(sessionId, finalMessages);
    }

    finalMessages = ensureVisibleAssistantReply(finalMessages);
    await saveMessages(sessionId, finalMessages);
    await notifyReviewCompleted(session, finalMessages);
    await markReviewSessionCompleted(sessionId);
    log.info(`审查完成 session=${sessionId}`);
  } catch (err) {
    log.error(`审查失败 session=${sessionId}`, err);
    const message = err instanceof Error ? err.message : String(err);
    await markReviewSessionFailed(sessionId, message);
  }
}
