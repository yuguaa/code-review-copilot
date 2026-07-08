import { loadSessionMessageTree } from './session-message-store.service';
import { prisma } from '../../infrastructure/prisma/prisma.service';
import {
  publishSessionError,
  publishSessionListChanged,
  publishSessionMessages,
  publishSessionStatus,
} from './session-events.service';

export const STOPPED_REVIEW_ERROR = '用户手动停止审查';

export async function markReviewSessionRunning(sessionId: string, activeLeafMessageId: string): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: { status: 'running', error: null, activeLeafMessageId, updatedAt: new Date() },
  });
  publishSessionStatus(sessionId, 'running');
  publishSessionListChanged();
}

export async function markReviewSessionCompleted(sessionId: string): Promise<void> {
  await prisma.session.update({ where: { id: sessionId }, data: { status: 'completed' } });
  publishSessionMessages(sessionId, await loadSessionMessageTree(sessionId));
  publishSessionStatus(sessionId, 'completed');
  publishSessionListChanged();
}

export async function markReviewSessionFailed(sessionId: string, error: string): Promise<void> {
  await prisma.session
    .update({
      where: { id: sessionId },
      data: { status: 'failed', error },
    })
    .catch(() => undefined);
  publishSessionError(sessionId, error);
  publishSessionStatus(sessionId, 'failed');
  publishSessionListChanged();
}

export function markReviewSessionStopped(sessionId: string): Promise<void> {
  return markReviewSessionFailed(sessionId, STOPPED_REVIEW_ERROR);
}
