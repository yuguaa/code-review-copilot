import {
  getSessionWithRepository,
  loadMessages,
  mergeStreamingMessage,
  saveMessages,
  updatePersistedMessageParts,
} from '../sessions/session-message-store.service';
import { createReviewStream } from './review-agent';
import { ensureVisibleAssistantReply, hasAssistantTextAfterLatestUser } from './review-message';
import { runReviewCompletionIntegrations } from './review-notification';
import {
  verifyReviewResult,
  withVerifiedReviewText,
} from './review-verify';
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
import { MISSING_REVIEW_TEXT_ERROR, publicReviewError } from './review-error';

const log = createLogger('run-review');
const activeReviewControllers = new Map<string, AbortController>();

type PendingReviewSnapshot = { messages: UIMessage[]; full: boolean };

function createReviewSnapshotPersister(sessionId: string, activityMessageId: string) {
  let pending: PendingReviewSnapshot | null = null;
  let running: Promise<void> | null = null;
  let failure: unknown = null;

  const persist = ({ messages, full }: PendingReviewSnapshot): Promise<void> => {
    if (full) return saveMessages(sessionId, messages);
    const activityMessage = messages.find((message) => message.id === activityMessageId);
    return activityMessage
      ? updatePersistedMessageParts(sessionId, activityMessage)
      : Promise.reject(new Error(`审查活动消息不存在：${activityMessageId}`));
  };

  const drain = (): Promise<void> => {
    if (running) return running;
    const writeNext = (): Promise<void> => {
      const snapshot = pending;
      pending = null;
      return snapshot ? persist(snapshot).then(writeNext) : Promise.resolve();
    };
    running = Promise.resolve()
      .then(writeNext)
      .catch((error) => {
        failure = error;
      })
      .finally(() => {
        running = null;
        if (pending && !failure) void drain();
      });
    return running;
  };

  const waitForIdle = (): Promise<void> => {
    if (failure) return Promise.reject(failure);
    if (running) return running.then(waitForIdle);
    if (pending) return drain().then(waitForIdle);
    return Promise.resolve();
  };

  return {
    schedule(snapshot: UIMessage[]) {
      if (failure) return;
      pending = { messages: snapshot, full: pending?.full === true };
      void drain();
    },
    flush(snapshot?: UIMessage[]) {
      if (snapshot) pending = { messages: snapshot, full: true };
      else if (pending) pending = { ...pending, full: true };
      if (!failure) void drain();
      return waitForIdle();
    },
  };
}

export function markReviewActivityFailed(
  state: ReviewActivityState,
  error: string,
  stopped = false,
): ReviewActivityState {
  return updateReviewAgentActivity(setReviewActivityPhase(failRunningReviewAgents(state), 'failed'), {
    id: 'review-error',
    label: stopped ? '审查已停止' : '审查流程',
    provider: 'system',
    modelId: 'runtime',
    task: error,
    status: 'failed',
  });
}

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
  const reviewRunId = randomUUID();
  const snapshotPersister = createReviewSnapshotPersister(sessionId, `review-activity-${reviewRunId}`);
  activeReviewControllers.set(sessionId, controller);
  let finalMessages: UIMessage[] | null = null;
  let activity: ReviewActivityState | null = null;

  const publishActivity: ReviewActivityReporter = (update, phase) => {
    if (!activity || !finalMessages) return;
    activity = updateReviewAgentActivity(activity, update);
    if (phase) activity = setReviewActivityPhase(activity, phase);
    finalMessages = upsertReviewActivityMessage(finalMessages, activity);
    publishSessionMessages(sessionId, finalMessages);
    snapshotPersister.schedule(finalMessages);
  };
  const publishPhase = (phase: ReviewActivityState['phase']) => {
    if (!activity || !finalMessages) return;
    activity = setReviewActivityPhase(activity, phase);
    finalMessages = upsertReviewActivityMessage(finalMessages, activity);
    publishSessionMessages(sessionId, finalMessages);
    snapshotPersister.schedule(finalMessages);
  };

  try {
    const session = await getSessionWithRepository(sessionId);
    if (!session) {
      log.error(`审查会话不存在：${sessionId}`);
      return;
    }

    throwIfStopped(controller.signal);
    const initial = await loadMessages(sessionId);
    activity = createReviewActivityState(reviewRunId);
    finalMessages = upsertReviewActivityMessage(initial, activity);
    await snapshotPersister.flush(finalMessages);
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
      onError: publicReviewError,
    });

    for await (const message of readUIMessageStream<UIMessage>({
      stream: uiStream,
      terminateOnError: true,
    })) {
      throwIfStopped(controller.signal);
      finalMessages = upsertReviewActivityMessage(mergeStreamingMessage(initial, message), activity);
      publishSessionMessages(sessionId, finalMessages);
    }

    throwIfStopped(controller.signal);
    const hasPrimaryReviewText = hasAssistantTextAfterLatestUser(finalMessages);
    finalMessages = ensureVisibleAssistantReply(finalMessages);
    if (!hasPrimaryReviewText) throw new Error(MISSING_REVIEW_TEXT_ERROR);
    publishActivity({
      id: 'primary',
      label: '主审查 Agent',
      provider: reviewRun.primaryConfig.provider,
      modelId: reviewRun.primaryConfig.modelId,
      task: '主审查结果与证据收集完成',
      status: 'completed',
    });
    const reviewMessages = finalMessages;
    let verifiedReviewText: string | null = null;
    if (reviewRun.verifiers.length >= 2) {
      await Promise.resolve().then(() => verifyReviewResult({
        ctx: reviewRun.ctx,
        messages: reviewMessages,
        verifiers: reviewRun.verifiers,
        assignmentSeed: session.id,
        blueprint: reviewRun.blueprint,
        runtimeMemory: reviewRun.runtimeMemory,
        abortSignal: controller.signal,
        onActivity: publishActivity,
      })).then((verifiedText) => {
        if (!finalMessages) throw new Error('审查消息状态丢失');
        finalMessages = withVerifiedReviewText(finalMessages, verifiedText);
        verifiedReviewText = verifiedText;
      }).catch((error) => {
        throwIfStopped(controller.signal);
        const errorText = publicReviewError(error);
        log.warn(`复核增强失败，保留主审查结论 session=${sessionId}`, { error: errorText });
        publishActivity({
          id: 'verification-result',
          label: '复核增强',
          provider: 'system',
          modelId: 'runtime',
          task: `复核增强未采用：${errorText}`,
          status: 'failed',
        }, 'verifying');
        if (activity && finalMessages) {
          activity = failRunningReviewAgents(activity);
          finalMessages = upsertReviewActivityMessage(finalMessages, activity);
          publishSessionMessages(sessionId, finalMessages);
        }
      });
    }
    throwIfStopped(controller.signal);
    publishPhase('completed');
    await snapshotPersister.flush(finalMessages);
    throwIfStopped(controller.signal);
    await markReviewSessionCompleted(sessionId);
    const integrationFailures = await runReviewCompletionIntegrations(
      reviewRun.ctx,
      session,
      finalMessages,
      verifiedReviewText,
    );
    if (integrationFailures.length) {
      log.warn(`审查已完成，但部分外部集成失败 session=${sessionId}`, {
        failures: integrationFailures.map(({ integration, error }) => ({
          integration,
          error: error instanceof Error ? error.message : String(error),
        })),
      });
    }
    log.info(`审查完成 session=${sessionId}`);
  } catch (err) {
    const stopped = isAbortError(err);
    if (stopped) {
      log.info(`审查已手动停止 session=${sessionId}`);
    } else {
      log.error(`审查失败 session=${sessionId}`, err);
    }
    const message = stopped ? STOPPED_REVIEW_ERROR : publicReviewError(err);
    if (activity && finalMessages) {
      activity = markReviewActivityFailed(activity, message, stopped);
      const failureMessages = upsertReviewActivityMessage(finalMessages, activity);
      finalMessages = failureMessages;
      await snapshotPersister.flush(failureMessages)
        .then(() => publishSessionMessages(sessionId, failureMessages))
        .catch((saveError) => log.error(`审查失败消息落库失败 session=${sessionId}`, saveError));
    }
    await markReviewSessionFailed(sessionId, message);
  } finally {
    activeReviewControllers.delete(sessionId);
  }
}
