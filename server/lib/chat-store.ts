import type { UIMessage } from 'ai';
import { randomUUID } from 'node:crypto';
import { prisma } from '../infrastructure/prisma/prisma.service';

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

/** 会话 + 仓库（含模型配置），供 chat route / agent 使用。 */
export function getSessionWithRepository(id: string) {
  return prisma.session.findUnique({
    where: { id },
    include: { repository: { include: { gitLabAccount: true, defaultAIModel: true } } },
  });
}

export type SessionWithRepository = NonNullable<
  Awaited<ReturnType<typeof getSessionWithRepository>>
>;

/** 会话列表（侧栏用），按最近活动时间倒序，带最后一条消息预览。 */
export async function listSessions(kind?: string) {
  const sessions = await prisma.session.findMany({
    where: kind ? { kind } : undefined,
    orderBy: { updatedAt: 'desc' },
    include: {
      repository: { select: { name: true, path: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
    take: 200,
  });
  return sessions.map((s) => ({
    id: s.id,
    kind: s.kind,
    title: s.title,
    status: s.status,
    mrIid: s.mrIid,
    sourceBranch: s.sourceBranch,
    targetBranch: s.targetBranch,
    repository: s.repository,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    preview: previewOf(s.messages[0]?.parts),
  }));
}

/** 从首条用户消息抽取一个简洁标题，供 chat 会话自动命名。 */
export function deriveChatTitle(messages: UIMessage[]): string | null {
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser) return null;
  const text = (firstUser.parts ?? [])
    .map((part) => {
      const p = part as { type?: unknown; text?: unknown };
      return p.type === 'text' && typeof p.text === 'string' ? p.text : '';
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

/** chat 会话若仍是空标题，则用首条用户消息自动命名（只命名一次）。 */
export async function ensureChatTitle(sessionId: string, messages: UIMessage[]): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { kind: true, title: true },
  });
  if (!session || session.kind !== 'chat' || session.title) return;
  const title = deriveChatTitle(messages);
  if (!title) return;
  await prisma.session.update({ where: { id: sessionId }, data: { title } });
}

/** 读取会话当前 active path（映射为 AI SDK UIMessage）。 */
export async function loadMessages(sessionId: string): Promise<UIMessage[]> {
  return (await loadSessionMessageTree(sessionId)).messages;
}

export async function loadSessionMessageTree(sessionId: string): Promise<SessionMessageTree> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { activeLeafMessageId: true },
  });
  const rows = await prisma.message.findMany({
    where: { sessionId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const activeLeafMessageId = pickActiveLeafId(rows, session?.activeLeafMessageId ?? null);
  const activePathIds = buildPathIds(rows, activeLeafMessageId);
  const activePath = new Set(activePathIds);
  const siblingIdsByParent = buildSiblingIdsByParent(rows);

  return {
    messages: rows
      .filter((row) => activePath.has(row.id))
      .sort((a, b) => activePathIds.indexOf(a.id) - activePathIds.indexOf(b.id))
      .map(toUIMessage),
    messageTree: rows.map((row) => {
      const siblingIds = siblingIdsByParent.get(row.parentId ?? null) ?? [row.id];
      return {
        id: row.id,
        parentId: row.parentId,
        role: row.role as UIMessage['role'],
        createdAt: row.createdAt,
        siblingIds,
        siblingIndex: Math.max(0, siblingIds.indexOf(row.id)),
        siblingCount: siblingIds.length,
        active: activePath.has(row.id),
      };
    }),
    activeLeafMessageId,
    activePathIds,
  };
}

/**
 * 持久化当前 active path：按 message id upsert，并用相邻 message 表达父子链。
 * 不删除其他分支，避免切换/分叉后丢失历史路径。
 */
export async function saveMessages(sessionId: string, messages: UIMessage[]): Promise<void> {
  const uniqueMessages = dedupeMessages(messages);
  const activeLeafMessageId = uniqueMessages.at(-1)?.id ?? null;

  await prisma.$transaction([
    ...uniqueMessages.map((m, index) =>
      prisma.message.upsert({
        where: { id: m.id },
        create: {
          id: m.id,
          sessionId,
          parentId: uniqueMessages[index - 1]?.id ?? null,
          role: m.role,
          parts: m.parts as object,
        },
        update: {
          parentId: uniqueMessages[index - 1]?.id ?? null,
          role: m.role,
          parts: m.parts as object,
        },
      }),
    ),
    prisma.session.update({
      where: { id: sessionId },
      data: { activeLeafMessageId, updatedAt: new Date() },
    }),
  ]);
}

export async function setActiveMessage(sessionId: string, messageId: string): Promise<SessionMessageTree | null> {
  const rows = await prisma.message.findMany({
    where: { sessionId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (!rows.some((row) => row.id === messageId)) return null;
  const leafId = pickLatestLeafId(rows, messageId);
  await prisma.session.update({
    where: { id: sessionId },
    data: { activeLeafMessageId: leafId, updatedAt: new Date() },
  });
  return loadSessionMessageTree(sessionId);
}

export function dedupeMessages(messages: UIMessage[]): UIMessage[] {
  const byId = new Map<string, UIMessage>();

  for (const message of messages) {
    const id = message.id || randomUUID();
    byId.set(id, { ...message, id });
  }

  return Array.from(byId.values());
}

/**
 * 保存流式结果前做一次历史保护：
 * AI SDK 回调理论上返回完整 messages，但任何短列表都不能覆盖掉已持久化历史。
 */
export function mergePersistedMessages(storedMessages: UIMessage[], finalMessages: UIMessage[]): UIMessage[] {
  const merged = new Map<string, UIMessage>();

  for (const message of dedupeMessages(storedMessages)) {
    merged.set(message.id, message);
  }

  for (const message of dedupeMessages(finalMessages)) {
    merged.set(message.id, message);
  }

  return Array.from(merged.values());
}

export function mergeStreamingMessage(baseMessages: UIMessage[], message: UIMessage): UIMessage[] {
  const last = baseMessages.at(-1);
  if (last?.role === 'assistant' && last.id === message.id) {
    return [...baseMessages.slice(0, -1), message];
  }
  return [...baseMessages, message];
}

/**
 * 追问请求的历史事实源是数据库，不信任浏览器回传的整组 messages。
 * AI SDK 请求里可能是完整前端态，也可能只包含本轮消息；这里仅提取最后一条新 user 消息追加。
 */
export function mergeIncomingUserMessage(storedMessages: UIMessage[], incomingMessages: UIMessage[]): UIMessage[] {
  const latestUserMessage = incomingMessages.findLast((message) => message.role === 'user');
  if (!latestUserMessage) return storedMessages;
  if (storedMessages.some((message) => message.id === latestUserMessage.id)) return storedMessages;
  return [...storedMessages, latestUserMessage];
}

export function mergeIncomingUserMessageAtParent(
  storedMessages: UIMessage[],
  incomingMessages: UIMessage[],
  parentMessageId?: string | null,
): UIMessage[] {
  const baseMessages = parentMessageId
    ? storedMessages.slice(0, storedMessages.findIndex((message) => message.id === parentMessageId) + 1)
    : storedMessages;
  if (parentMessageId && baseMessages.length === 0) return storedMessages;
  return mergeIncomingUserMessage(baseMessages, incomingMessages);
}

function toUIMessage(row: MessageRow): UIMessage {
  return {
    id: row.id,
    role: row.role as UIMessage['role'],
    parts: row.parts as UIMessage['parts'],
  };
}

export function pickActiveLeafId(rows: MessageRow[], activeLeafMessageId: string | null): string | null {
  if (activeLeafMessageId && rows.some((row) => row.id === activeLeafMessageId)) return activeLeafMessageId;
  return rows.at(-1)?.id ?? null;
}

export function buildPathIds(rows: MessageRow[], leafId: string | null): string[] {
  if (!leafId) return [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const path: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(leafId);
  while (current && !seen.has(current.id)) {
    path.push(current.id);
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path.reverse();
}

export function buildSiblingIdsByParent(rows: MessageRow[]): Map<string | null, string[]> {
  const groups = new Map<string | null, string[]>();
  for (const row of rows) {
    const key = row.parentId ?? null;
    groups.set(key, [...(groups.get(key) ?? []), row.id]);
  }
  return groups;
}

export function pickLatestLeafId(rows: MessageRow[], messageId: string): string {
  const childrenByParent = new Map<string, MessageRow[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    childrenByParent.set(row.parentId, [...(childrenByParent.get(row.parentId) ?? []), row]);
  }
  let currentId = messageId;
  for (;;) {
    const children = childrenByParent.get(currentId);
    if (!children?.length) return currentId;
    currentId = children[children.length - 1].id;
  }
}

/** 从 UIMessage.parts 里抽一段纯文本预览。 */
function previewOf(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  const text = parts
    .map((p) => previewPart(p))
    .filter(Boolean)
    .join(' ')
    .trim();
  return text.slice(0, 120);
}

function previewPart(part: unknown): string {
  if (!part || typeof part !== 'object') return '';
  const p = part as { type?: unknown; text?: unknown; toolName?: unknown; state?: unknown };
  if (p.type === 'text' && typeof p.text === 'string') return p.text;
  if (p.type === 'reasoning' && typeof p.text === 'string') return `推理：${p.text}`;
  if (p.type === 'step-start') return '模型开始生成';
  if (p.type === 'dynamic-tool') return `调用工具：${String(p.toolName ?? '未知工具')}`;
  if (typeof p.type === 'string' && p.type.startsWith('tool-')) return `调用工具：${p.type.replace(/^tool-/, '')}`;
  return typeof p.type === 'string' ? `模型事件：${p.type}` : '';
}
