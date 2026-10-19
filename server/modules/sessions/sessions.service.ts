import { HTTPException } from 'hono/http-exception';

import { prisma } from '@server/infrastructure/prisma/prisma.service';
import { isChatSessionActive } from '@server/platform/chat/chat-runtime';
import { cancelSessionReview, enqueueSessionReview } from '@server/platform/runs/run-service';
import { publishSessionListChanged, publishSessionMessages } from './session-events.service';
import { busySessionStatuses, isSessionBusy } from './session-lifecycle.service';
import { buildSessionMessageTree, loadSessionMessageTree, lockSession, setActiveMessage } from './session-message-store.service';

import type { SessionWithRepository } from './session-message-store.service';

export function listSessionSummaries(kind?: string) {
  if (kind && !['review', 'chat'].includes(kind)) throw new HTTPException(400, { message: '会话类型无效' });
  return prisma.session.findMany({
    where: kind ? { kind } : undefined,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 200,
    include: {
      repository: { select: { id: true, name: true, path: true, gitLabAccount: { select: { url: true } } } },
      activeLeafMessage: { select: { parts: true } },
    },
  }).then((sessions) => sessions.map((session) => ({
    id: session.id,
    kind: session.kind,
    title: session.title,
    status: session.status,
    mrIid: session.mrIid,
    sourceBranch: session.sourceBranch,
    targetBranch: session.targetBranch,
    repository: repositorySummary(session.repository),
    webUrl: sessionWebUrl(session),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    preview: Array.isArray(session.activeLeafMessage?.parts)
      ? session.activeLeafMessage.parts.flatMap((part) =>
        part && typeof part === 'object' && 'type' in part && part.type === 'text' && 'text' in part && typeof part.text === 'string'
          ? [part.text] : []).join(' ').slice(0, 120)
      : '',
  })));
}

export function loadSessionDetail(id: string) {
  return prisma.$transaction((transaction) => lockSession(transaction, id)
    .then(() => transaction.session.findUniqueOrThrow({
      where: { id },
      include: {
        repository: { include: { gitLabAccount: true } },
        messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        runs: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
      },
    }))
    .then((session) => ({
      session: {
        id: session.id,
        kind: session.kind,
        title: session.title,
        status: session.status,
        mrIid: session.mrIid,
        mrTitle: session.mrTitle,
        sourceBranch: session.sourceBranch,
        targetBranch: session.targetBranch,
        baseCommitSha: session.baseCommitSha,
        commitSha: session.commitSha,
        author: session.author,
        error: session.error,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        repository: repositorySummary(session.repository),
        webUrl: sessionWebUrl(session),
      },
      ...buildSessionMessageTree(session.messages, session.activeLeafMessageId),
      runs: session.runs,
    })));
}

export function sessionExists(id: string): Promise<boolean> {
  return prisma.session.count({ where: { id } }).then((count) => count === 1);
}

export function switchActiveMessage(sessionId: string, messageId: string) {
  assertChatIdle(sessionId);
  return setActiveMessage(sessionId, messageId).then((tree) => {
    publishSessionMessages(sessionId, tree);
    publishSessionListChanged();
    return tree;
  });
}

export function createChatSession(body: { repositoryId?: string | null; title?: string }) {
  return (body.repositoryId
    ? prisma.repository.findUnique({ where: { id: body.repositoryId }, select: { id: true } }).then((repository) => {
      if (!repository) throw new HTTPException(404, { message: '仓库不存在' });
    })
    : Promise.resolve())
    .then(() => prisma.session.create({
      data: { kind: 'chat', title: body.title || null, repositoryId: body.repositoryId ?? null, status: 'completed' },
    }))
    .then((session) => {
      publishSessionListChanged();
      return session;
    });
}

export function deleteSession(id: string): Promise<{ success: true }> {
  assertChatIdle(id);
  return prisma.$transaction((transaction) => lockSession(transaction, id)
    .then(() => transaction.session.findUniqueOrThrow({
      where: { id },
      include: { runs: { where: { status: { in: [...busySessionStatuses] } }, select: { id: true }, take: 1 } },
    }))
    .then((session) => {
      assertChatIdle(id);
      if (isSessionBusy(session.status) || session.runs.length) {
        throw new HTTPException(409, { message: '当前审查正在执行，不能删除会话' });
      }
      return transaction.session.delete({ where: { id } });
    }))
    .then(() => {
      publishSessionListChanged();
      return { success: true };
    });
}

export function runReviewCommand(sessionId: string) {
  assertChatIdle(sessionId);
  return enqueueSessionReview(sessionId).then(() => loadSessionMessageTree(sessionId));
}

export function stopReviewSession(sessionId: string): Promise<{ success: true }> {
  return cancelSessionReview(sessionId).then(() => ({ success: true }));
}

function assertChatIdle(sessionId: string): void {
  if (isChatSessionActive(sessionId)) throw new HTTPException(409, { message: '当前会话正在生成回答' });
}

function repositorySummary(repository: RepositorySummaryInput | null) {
  if (!repository) return null;
  return { id: repository.id, name: repository.name, path: repository.path, webUrl: projectWebUrl(repository) };
}

function projectWebUrl(repository: RepositorySummaryInput): string {
  return `${repository.gitLabAccount.url.replace(/\/+$/, '')}/${repository.path}`;
}

function sessionWebUrl(session: { repository: RepositorySummaryInput | null; mrIid: number | null; commitSha: string | null }): string | null {
  if (!session.repository) return null;
  const base = projectWebUrl(session.repository);
  if (session.mrIid !== null) return `${base}/-/merge_requests/${session.mrIid}`;
  return session.commitSha ? `${base}/-/commit/${session.commitSha}` : base;
}

type RepositorySummaryInput = Pick<NonNullable<SessionWithRepository['repository']>, 'id' | 'name' | 'path'> & {
  gitLabAccount: { url: string };
};
