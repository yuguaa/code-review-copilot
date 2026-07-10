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
import { randomUUID } from 'node:crypto';
import {
  createReviewActivityState,
  failRunningReviewAgents,
  setReviewActivityPhase,
  updateReviewAgentActivity,
  upsertReviewActivityMessage,
  type ReviewActivityState,
  type ReviewActivityReporter,
} from './review-activity';

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
  let activity: ReviewActivityState | null = null;

  const publishActivity: ReviewActivityReporter = (update, phase) => {
    if (!activity || !finalMessages) return;
    activity = updateReviewAgentActivity(activity, update);
    if (phase) activity = setReviewActivityPhase(activity, phase);
    finalMessages = upsertReviewActivityMessage(finalMessages, activity);
    publishSessionMessages(sessionId, finalMessages);
  };

  try {
    const session = await getSessionWithRepository(sessionId);
    if (!session) {
      log.error(`审查会话不存在：${sessionId}`);
      return;
    }

    throwIfStopped(controller.signal);
    const initial = await loadMessages(sessionId);
    activity = createReviewActivityState(randomUUID());
    finalMessages = upsertReviewActivityMessage(initial, activity);
    await saveMessages(sessionId, finalMessages);
    publishSessionMessages(sessionId, finalMessages);
    const reviewRun = await createReviewStream({
      session,
      messages: initial,
      abortSignal: controller.signal,
      onActivity: publishActivity,
    });
    throwIfStopped(controller.signal);

    const uiStream = reviewRun.stream.toUIMessageStream({
      originalMessages: initial,
    });

    for await (const message of readUIMessageStream<UIMessage>({ stream: uiStream })) {
      throwIfStopped(controller.signal);
      finalMessages = upsertReviewActivityMessage(mergeStreamingMessage(initial, message), activity);
      publishSessionMessages(sessionId, finalMessages);
    }

    throwIfStopped(controller.signal);
    publishActivity({
      id: 'primary',
      label: '主审查 Agent',
      provider: reviewRun.primaryConfig.provider,
      modelId: reviewRun.primaryConfig.modelId,
      task: '主审查草稿与证据收集完成',
      status: 'completed',
    });
    finalMessages = ensureVisibleAssistantReply(finalMessages);
    publishActivity({
      id: 'verifier',
      label: 'Verify Agent',
      provider: reviewRun.verifierConfig.provider,
      modelId: reviewRun.verifierConfig.modelId,
      task: '逐条核验主审查结论与代码证据',
      status: 'running',
    }, 'verifying');
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
    publishActivity({
      id: 'verifier',
      label: 'Verify Agent',
      provider: reviewRun.verifierConfig.provider,
      modelId: reviewRun.verifierConfig.modelId,
      task: '结论复核完成',
      status: 'completed',
    }, 'completed');
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
    if (activity && finalMessages) {
      activity = failRunningReviewAgents(activity);
      finalMessages = upsertReviewActivityMessage(finalMessages, activity);
      publishSessionMessages(sessionId, finalMessages);
    }
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
