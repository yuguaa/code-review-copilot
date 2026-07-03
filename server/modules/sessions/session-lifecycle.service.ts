import { loadSessionMessageTree } from '../../lib/chat-store';
import { prisma } from '../../lib/prisma';
import {
  publishSessionError,
  publishSessionListChanged,
  publishSessionMessages,
  publishSessionStatus,
} from '../../lib/session-events';

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
