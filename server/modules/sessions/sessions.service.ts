import { runReviewSession } from '../../agent/run-review';
import {
  getSessionWithRepository,
  listSessions,
  loadSessionMessageTree,
  setActiveMessage,
  type SessionMessageTree,
} from '../../lib/chat-store';
import { prisma } from '../../lib/prisma';
import {
  publishSessionListChanged,
  publishSessionMessages,
  publishSessionStatus,
} from '../../lib/session-events';

export function listSessionSummaries(kind?: string) {
  return listSessions(kind);
}

export function loadSessionDetail(id: string) {
  return getSessionWithRepository(id).then((session) => {
    if (!session) return null;
    return loadSessionMessageTree(id).then((tree) => ({
      session: {
        id: session.id,
        kind: session.kind,
        title: session.title,
        status: session.status,
        mrIid: session.mrIid,
        mrTitle: session.mrTitle,
        sourceBranch: session.sourceBranch,
        targetBranch: session.targetBranch,
        commitSha: session.commitSha,
        author: session.author,
        error: session.error,
        updatedAt: session.updatedAt,
        repository: session.repository
          ? { id: session.repository.id, name: session.repository.name, path: session.repository.path }
          : null,
      },
      messages: tree.messages,
      messageTree: tree.messageTree,
      activeLeafMessageId: tree.activeLeafMessageId,
      activePathIds: tree.activePathIds,
    }));
  });
}

export function sessionExists(id: string) {
  return getSessionWithRepository(id).then(Boolean);
}

export function switchActiveMessage(sessionId: string, messageId: string) {
  return setActiveMessage(sessionId, messageId).then((tree) => {
    if (!tree) return null;
    publishSessionListChanged();
    return tree;
  });
}

export function createChatSession(body: { repositoryId?: unknown; title?: unknown }) {
  const repositoryId = typeof body.repositoryId === 'string' ? body.repositoryId : null;
  return prisma.session
    .create({
      data: {
        kind: 'chat',
        title: typeof body.title === 'string' ? body.title : null,
        repositoryId,
        status: 'completed',
      },
    })
    .then((session) => {
      publishSessionListChanged();
      return session;
    });
}

export function deleteSession(id: string) {
  return prisma.session.delete({ where: { id } }).catch(() => undefined).then(() => {
    publishSessionListChanged();
    return { success: true };
  });
}

type ReviewCommandResult =
  | { kind: 'missing' }
  | { kind: 'invalid-kind' }
  | { kind: 'running' }
  | { kind: 'missing-seed' }
  | { kind: 'started'; tree: SessionMessageTree };

export function runReviewCommand(sessionId: string): Promise<ReviewCommandResult> {
  return getSessionWithRepository(sessionId).then((session) => {
    if (!session) return { kind: 'missing' as const };
    if (session.kind !== 'review') return { kind: 'invalid-kind' as const };
    if (session.status === 'running') return { kind: 'running' as const };

    return loadSessionMessageTree(sessionId).then((tree) => {
      const seed = tree.messages[0];
      if (!seed || seed.role !== 'user') return { kind: 'missing-seed' as const };

      return prisma.message
        .create({
          data: {
            sessionId,
            parentId: seed.id,
            role: 'user',
            parts: [
              {
                type: 'text',
                text: '代码审查指令：重新执行本次 review。审查完成后按当前仓库配置发布 GitLab 评论和钉钉通知。',
              },
            ],
          },
        })
        .then((command) =>
          prisma.session.update({
            where: { id: sessionId },
            data: { status: 'running', error: null, activeLeafMessageId: command.id, updatedAt: new Date() },
          }),
        )
        .then(() => loadSessionMessageTree(sessionId))
        .then((next) => {
          publishSessionMessages(sessionId, next);
          publishSessionStatus(sessionId, 'running');
          publishSessionListChanged();
          void runReviewSession(sessionId);
          return { kind: 'started' as const, tree: next };
        });
    });
  });
}
