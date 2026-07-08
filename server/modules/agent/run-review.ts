import {
  getSessionWithRepository,
  loadMessages,
  mergeStreamingMessage,
  saveMessages,
} from '../sessions/session-message-store.service';
import { createReviewStream } from './review-agent';
import { ensureVisibleAssistantReply } from './review-message';
import { notifyReviewCompleted, publishVerifiedReview, rememberVerifiedReview } from './review-notification';
import { verifyReviewResult, withVerifiedReviewText } from './review-verify';
import { createLogger } from '../../shared/logger/logger.service';
import { publishSessionMessages } from '../sessions/session-events.service';
import { readUIMessageStream, type UIMessage } from 'ai';
import {
  markReviewSessionCompleted,
  markReviewSessionFailed,
  STOPPED_REVIEW_ERROR,
} from '../sessions/session-lifecycle.service';

const log = createLogger('run-review');
const activeReviewControllers = new Map<string, AbortController>();

function abortError(): Error {
  const error = new Error(STOPPED_REVIEW_ERROR);
  error.name = 'AbortError';
  return error;
}

function throwIfStopped(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.message === STOPPED_REVIEW_ERROR);
}

export function stopRunningReviewSession(sessionId: string): boolean {
  const controller = activeReviewControllers.get(sessionId);
  if (!controller) return false;
  controller.abort();
  return true;
}

/**
 * 后台跑一次完整审查：加载会话与种子消息 → 跑主 agent → 流式落库 → 更新状态。
 * 由 webhook fire-and-forget 调用；自身吞掉异常并落 failed 状态。
 */
export async function runReviewSession(sessionId: string): Promise<void> {
  const controller = new AbortController();
  activeReviewControllers.set(sessionId, controller);
  let finalMessages: UIMessage[] | null = null;

  try {
    const session = await getSessionWithRepository(sessionId);
    if (!session) {
      log.error(`审查会话不存在：${sessionId}`);
      return;
    }

    throwIfStopped(controller.signal);
    const initial = await loadMessages(sessionId);
    finalMessages = initial;
    const reviewRun = await createReviewStream({ session, messages: initial, abortSignal: controller.signal });
    throwIfStopped(controller.signal);

    const uiStream = reviewRun.stream.toUIMessageStream({
      originalMessages: initial,
      onEnd: ({ messages }) => {
        finalMessages = messages;
      },
    });

    for await (const message of readUIMessageStream<UIMessage>({ stream: uiStream })) {
      throwIfStopped(controller.signal);
      finalMessages = mergeStreamingMessage(initial, message);
      publishSessionMessages(sessionId, finalMessages);
    }

    throwIfStopped(controller.signal);
    finalMessages = ensureVisibleAssistantReply(finalMessages);
    const verifiedText = await verifyReviewResult({
      ctx: reviewRun.ctx,
      messages: finalMessages,
      model: reviewRun.verifierModel,
      maxSteps: reviewRun.verifierConfig.maxSteps,
      blueprint: reviewRun.blueprint,
      runtimeMemory: reviewRun.runtimeMemory,
      abortSignal: controller.signal,
    });
    throwIfStopped(controller.signal);
    finalMessages = withVerifiedReviewText(finalMessages, verifiedText);
    await saveMessages(sessionId, finalMessages);
    throwIfStopped(controller.signal);
    await rememberVerifiedReview(reviewRun.ctx, verifiedText);
    throwIfStopped(controller.signal);
    await publishVerifiedReview(reviewRun.ctx, verifiedText);
    throwIfStopped(controller.signal);
    await notifyReviewCompleted(session, finalMessages);
    throwIfStopped(controller.signal);
    await markReviewSessionCompleted(sessionId);
    log.info(`审查完成 session=${sessionId}`);
  } catch (err) {
    const stopped = isAbortError(err);
    if (finalMessages) await saveMessages(sessionId, finalMessages).catch(() => undefined);
    if (stopped) {
      log.info(`审查已手动停止 session=${sessionId}`);
    } else {
      log.error(`审查失败 session=${sessionId}`, err);
    }
    const message = stopped ? STOPPED_REVIEW_ERROR : err instanceof Error ? err.message : String(err);
    await markReviewSessionFailed(sessionId, message);
  } finally {
    activeReviewControllers.delete(sessionId);
  }
}
