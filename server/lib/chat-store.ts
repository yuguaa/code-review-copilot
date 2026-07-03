import type { UIMessage } from 'ai';
import { randomUUID } from 'node:crypto';
import { prisma } from './prisma';

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

/** 读取会话的线性消息（映射为 AI SDK UIMessage）。 */
export async function loadMessages(sessionId: string): Promise<UIMessage[]> {
  const rows = await prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    role: r.role as UIMessage['role'],
    parts: r.parts as UIMessage['parts'],
  }));
}

/**
 * 持久化会话消息：整组替换（onFinish 给的是完整 messages 数组）。
 * 用事务保证一致性，并刷新 session.updatedAt。
 */
export async function saveMessages(sessionId: string, messages: UIMessage[]): Promise<void> {
  const uniqueMessages = dedupeMessages(messages);

  await prisma.$transaction([
    prisma.message.deleteMany({ where: { sessionId } }),
    prisma.message.createMany({
      data: uniqueMessages.map((m) => ({
        id: m.id,
        sessionId,
        role: m.role,
        parts: m.parts as object,
      })),
      skipDuplicates: true,
    }),
    prisma.session.update({ where: { id: sessionId }, data: { updatedAt: new Date() } }),
  ]);
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
