import { safeValidateUIMessages } from 'ai';
import { HTTPException } from 'hono/http-exception';

import { prisma } from '@server/infrastructure/prisma/prisma.service';

import type { UIMessage } from 'ai';
import type { Prisma } from '@prisma/client';

export function getSessionWithRepository(id: string) {
  return prisma.session.findUnique({
    where: { id },
    include: { repository: { include: { gitLabAccount: true, defaultAIModel: true } } },
  });
}

export function deriveChatTitle(messages: UIMessage[]): string | null {
  const message = messages.find((item) => item.role === 'user');
  const text = message?.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? (text.length > 24 ? `${text.slice(0, 24)}…` : text) : null;
}

export function ensureChatTitle(sessionId: string, messages: UIMessage[]): Promise<void> {
  const title = deriveChatTitle(messages);
  if (!title) return Promise.resolve();
  return prisma.session.updateMany({
    where: { id: sessionId, kind: 'chat', OR: [{ title: null }, { title: '' }] },
    data: { title },
  }).then(() => undefined);
}

/** 事务中的会话行锁统一保护父子关系与当前分支。 */
export function lockSession(transaction: Prisma.TransactionClient, sessionId: string): Promise<void> {
  return transaction.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM sessions WHERE id = ${sessionId} FOR UPDATE
  `.then((rows) => {
    if (rows.length !== 1) throw new HTTPException(404, { message: '会话不存在' });
  });
}

export function loadMessages(sessionId: string): Promise<UIMessage[]> {
  return loadSessionMessageTree(sessionId).then((tree) => tree.messages);
}

export function loadSessionMessageTree(sessionId: string): Promise<SessionMessageTree> {
  return prisma.$transaction((transaction) => lockSession(transaction, sessionId)
    .then(() => Promise.all([
      transaction.session.findUniqueOrThrow({ where: { id: sessionId } }),
      transaction.message.findMany({ where: { sessionId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    ]))
    .then(([session, rows]) => buildSessionMessageTree(rows, session.activeLeafMessageId)));
}

export function buildSessionMessageTree(rows: MessageRow[], activeMessageId: string | null): SessionMessageTree {
  const activeLeafMessageId = pickActiveLeafId(rows, activeMessageId);
  const activePathIds = buildPathIds(rows, activeLeafMessageId);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const activePath = new Set(activePathIds);
  const siblings = buildSiblingIdsByParent(rows);
  return {
    messages: activePathIds.map((id) => {
      const row = byId.get(id)!;
      if (!['user', 'assistant', 'system'].includes(row.role)) throw new Error('持久化消息角色无效');
      return { id, role: row.role as UIMessage['role'], parts: row.parts as UIMessage['parts'] };
    }),
    messageTree: rows.map((row) => {
      const siblingIds = siblings.get(row.parentId)!;
      return {
        id: row.id,
        parentId: row.parentId,
        role: row.role as UIMessage['role'],
        createdAt: row.createdAt,
        siblingIds,
        siblingIndex: siblingIds.indexOf(row.id),
        siblingCount: siblingIds.length,
        active: activePath.has(row.id),
      };
    }),
    activeLeafMessageId,
    activePathIds,
  };
}

/** 仅供服务端生成内容使用；已有消息的会话、角色和父节点不可变更。 */
export function saveMessages(sessionId: string, messages: UIMessage[]): Promise<void> {
  return safeValidateUIMessages({ messages }).then((validation) => {
    if (!validation.success) throw validation.error;
    if (new Set(messages.map((message) => message.id)).size !== messages.length) {
      throw new HTTPException(400, { message: '消息 ID 重复' });
    }
    return prisma.$transaction((transaction) => lockSession(transaction, sessionId)
      .then(() => transaction.message.findMany({ where: { id: { in: messages.map((message) => message.id) } } }))
      .then((existing) => {
        const byId = new Map(existing.map((message) => [message.id, message]));
        return messages.reduce<Promise<void>>((pending, message, index) => pending.then(() => {
          const parentId = messages[index - 1]?.id ?? null;
          const current = byId.get(message.id);
          if (current && (current.sessionId !== sessionId || current.parentId !== parentId || current.role !== message.role)) {
            throw new HTTPException(409, { message: '消息 ID 已被使用，不能更改消息归属或父节点' });
          }
          return transaction.message.upsert({
            where: { id: message.id },
            create: { id: message.id, sessionId, parentId, role: message.role, parts: message.parts as Prisma.InputJsonValue },
            update: { parts: message.parts as Prisma.InputJsonValue },
          }).then(() => undefined);
        }), Promise.resolve());
      })
      .then(() => transaction.session.update({
        where: { id: sessionId },
        data: { activeLeafMessageId: messages.at(-1)?.id ?? null, updatedAt: new Date() },
      }))
      .then(() => undefined));
  });
}

export function updatePersistedMessageParts(sessionId: string, message: UIMessage): Promise<void> {
  return prisma.$transaction((transaction) => lockSession(transaction, sessionId)
    .then(() => transaction.message.updateMany({
      where: { id: message.id, sessionId, role: message.role },
      data: { parts: message.parts as Prisma.InputJsonValue },
    }))
    .then(({ count }) => {
      if (count !== 1) throw new HTTPException(404, { message: '消息不存在' });
      return transaction.session.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });
    })
    .then(() => undefined));
}

export function setActiveMessage(sessionId: string, messageId: string): Promise<SessionMessageTree> {
  return prisma.$transaction((transaction) => lockSession(transaction, sessionId)
    .then(() => transaction.message.findMany({ where: { sessionId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }))
    .then((rows) => {
      if (!rows.some((row) => row.id === messageId)) throw new HTTPException(404, { message: '消息不存在' });
      const leafId = pickLatestLeafId(rows, messageId);
      return transaction.session.update({ where: { id: sessionId }, data: { activeLeafMessageId: leafId } })
        .then(() => buildSessionMessageTree(rows, leafId));
    }));
}

export function pickActiveLeafId(rows: MessageRow[], activeMessageId: string | null): string | null {
  const selected = activeMessageId ?? rows.at(-1)?.id;
  if (!selected) return null;
  if (!rows.some((row) => row.id === selected)) throw new Error('当前分支消息不存在');
  return pickLatestLeafId(rows, selected);
}

export function buildPathIds(rows: MessageRow[], leafId: string | null): string[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const seen = new Set<string>();
  const path: string[] = [];
  let currentId = leafId;
  while (currentId) {
    if (seen.has(currentId)) throw new Error('消息树存在循环');
    const row = byId.get(currentId);
    if (!row) throw new Error('消息树父节点不存在');
    seen.add(currentId);
    path.push(currentId);
    currentId = row.parentId;
  }
  return path.reverse();
}

export function buildSiblingIdsByParent(rows: MessageRow[]): Map<string | null, string[]> {
  const groups = new Map<string | null, string[]>();
  for (const row of rows) {
    const siblings = groups.get(row.parentId) ?? [];
    siblings.push(row.id);
    groups.set(row.parentId, siblings);
  }
  return groups;
}

export function pickLatestLeafId(rows: MessageRow[], messageId: string): string {
  const children = buildSiblingIdsByParent(rows);
  const seen = new Set<string>();
  let currentId = messageId;
  while (children.get(currentId)?.length) {
    if (seen.has(currentId)) throw new Error('消息树存在循环');
    seen.add(currentId);
    currentId = children.get(currentId)!.at(-1)!;
  }
  return currentId;
}

export type SessionWithRepository = NonNullable<Awaited<ReturnType<typeof getSessionWithRepository>>>;

export type MessageRow = {
  id: string;
  parentId: string | null;
  role: string;
  parts: unknown;
  createdAt: Date;
};

export type MessageTreeNode = {
  id: string;
  parentId: string | null;
  role: UIMessage['role'];
  createdAt: Date;
  siblingIds: string[];
  siblingIndex: number;
  siblingCount: number;
  active: boolean;
};

export type SessionMessageTree = {
  messages: UIMessage[];
  messageTree: MessageTreeNode[];
  activeLeafMessageId: string | null;
  activePathIds: string[];
};
