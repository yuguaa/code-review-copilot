import { loadSessionMessageTree } from './session-message-store.service';
import { prisma } from '../../infrastructure/prisma/prisma.service';
import {
  publishSessionError,
  publishSessionListChanged,
  publishSessionMessages,
  publishSessionStatus,
} from './session-events.service';

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
