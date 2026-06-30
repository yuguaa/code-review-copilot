import { prisma } from '../lib/prisma';
import { getSessionWithRepository, loadMessages, mergeStreamingMessage, saveMessages } from '../lib/chat-store';
import { createReviewStream } from './review-agent';
import { ensureVisibleAssistantReply } from './review-message';
import { notifyReviewCompleted } from './review-notification';
import { createLogger } from '../lib/logger';
import {
  publishSessionError,
  publishSessionListChanged,
  publishSessionMessages,
  publishSessionStatus,
} from '../lib/session-events';
import { readUIMessageStream, type UIMessage } from 'ai';

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
    await prisma.session.update({ where: { id: sessionId }, data: { status: 'completed' } });
    publishSessionMessages(sessionId, finalMessages);
    publishSessionStatus(sessionId, 'completed');
    publishSessionListChanged();
    log.info(`审查完成 session=${sessionId}`);
  } catch (err) {
    log.error(`审查失败 session=${sessionId}`, err);
    const message = err instanceof Error ? err.message : String(err);
    await prisma.session
      .update({
        where: { id: sessionId },
        data: { status: 'failed', error: message },
      })
      .catch(() => undefined);
    publishSessionError(sessionId, message);
    publishSessionStatus(sessionId, 'failed');
    publishSessionListChanged();
  }
}
