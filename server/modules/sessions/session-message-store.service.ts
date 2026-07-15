import type { UIMessage } from 'ai';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../infrastructure/prisma/prisma.service';
import {
  isVerifiedReviewPart,
  normalizeFindingText,
  parseReviewFindings,
} from '../../../shared/review-findings';

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

export const messageFeedbackValues = ['up', 'down'] as const;
export type MessageFeedbackValue = (typeof messageFeedbackValues)[number];

export type MessageFeedbackResult =
  | { kind: 'missing-message' }
  | { kind: 'missing-repository' }
  | { kind: 'missing-finding' }
  | { kind: 'updated'; tree: SessionMessageTree };

export type MessageFeedbackApplication =
  | { kind: 'missing-finding' }
  | { kind: 'updated'; parts: UIMessage['parts'] };

const feedbackMemoryHeader = '## 用户反馈阈值沉淀';
const legacyFeedbackMemoryHeader = '## 用户反馈沉淀';
const feedbackThreshold = { minTotal: 3, minNet: 2 } as const;

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function projectWebUrl(repo: { path: string; gitLabAccount?: { url: string } | null } | null): string | null {
  if (!repo?.gitLabAccount?.url) return null;
  return `${trimSlash(repo.gitLabAccount.url)}/${repo.path}`;
}

function sessionWebUrl(session: {
  mrIid: number | null;
  commitSha: string | null;
  repository: { path: string; gitLabAccount?: { url: string } | null } | null;
}): string | null {
  const base = projectWebUrl(session.repository);
  if (!base) return null;
  if (session.mrIid != null) return `${base}/-/merge_requests/${session.mrIid}`;
  if (session.commitSha) return `${base}/-/commit/${session.commitSha}`;
  return base;
}

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
      repository: { select: { name: true, path: true, gitLabAccount: { select: { url: true } } } },
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
    repository: s.repository ? { name: s.repository.name, path: s.repository.path, webUrl: projectWebUrl(s.repository) } : null,
    webUrl: sessionWebUrl(s),
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

/** 运行中只更新已落库消息的 parts，避免每个流事件重复 upsert 整条 active path。 */
export function updatePersistedMessageParts(sessionId: string, message: UIMessage): Promise<void> {
  return prisma.$transaction((transaction) =>
    transaction.message
      .updateMany({
        where: { id: message.id, sessionId },
        data: { parts: message.parts as object },
      })
      .then(({ count }) => {
        if (count !== 1) throw new Error(`待更新消息不存在：${message.id}`);
        return transaction.session.update({
          where: { id: sessionId },
          data: { updatedAt: new Date() },
        });
      }),
  ).then(() => undefined);
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

export async function setMessageFeedback(
  sessionId: string,
  messageId: string,
  feedback: MessageFeedbackValue,
  findingText: string,
): Promise<MessageFeedbackResult> {
  const message = await prisma.message.findFirst({
    where: { id: messageId, sessionId, role: 'assistant' },
    include: {
      session: {
        select: {
          repositoryId: true,
          repository: { select: { memory: true } },
        },
      },
    },
  });
  if (!message) return { kind: 'missing-message' };
  if (!message.session.repositoryId) return { kind: 'missing-repository' };

  const application = applyMessageFeedback(message.parts, feedback, findingText);
  if (application.kind === 'missing-finding') return application;
  const nextParts = application.parts;
  const repositoryId = message.session.repositoryId;

  await prisma.message.update({
    where: { id: message.id },
    data: { parts: nextParts as object },
  });

  const rows = await prisma.message.findMany({
    where: { role: 'assistant', session: { repositoryId } },
    select: { parts: true },
  });
  const memorySection = buildThresholdFeedbackMemorySection(collectFeedbackStats(rows.map((row) => row.parts)));
  const nextMemory = mergeThresholdFeedbackMemory(message.session.repository?.memory, memorySection);
  await prisma.repository.update({
    where: { id: repositoryId },
    data: { memory: nextMemory },
  });

  return { kind: 'updated', tree: await loadSessionMessageTree(sessionId) };
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

export function applyMessageFeedback(
  parts: unknown,
  feedback: MessageFeedbackValue,
  findingText: string,
): MessageFeedbackApplication {
  const list = Array.isArray(parts) ? parts : [];
  const targetText = normalizeFindingText(findingText);
  const target = findVerifiedFindingTarget(list, targetText);
  if (!target) return { kind: 'missing-finding' };
  const feedbackAt = new Date().toISOString();
  const nextParts = list.map((part, index) => {
    if (!part || typeof part !== 'object') return part;
    const record = part as Record<string, unknown>;
    if (record.type !== 'text') return part;
    if (index !== target.partIndex) return part;
    const existing = Array.isArray(record.findingFeedbacks) ? record.findingFeedbacks : [];
    const findingFeedbacks = [
      ...existing.filter((item) => {
        const entry = item as { text?: unknown };
        return normalizeFindingText(typeof entry.text === 'string' ? entry.text : '') !== target.text;
      }),
      { text: target.text, feedback, feedbackAt },
    ];
    return {
      ...record,
      findingFeedbacks,
    };
  }) as UIMessage['parts'];
  return { kind: 'updated', parts: nextParts };
}

function findVerifiedFindingTarget(
  parts: unknown[],
  targetText: string,
): { partIndex: number; text: string } | null {
  if (!targetText) return null;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (!isVerifiedReviewPart(part)) continue;
    const finding = parseReviewFindings(part.text).find(
      (item) => normalizeFindingText(item.title) === targetText,
    );
    if (finding) return { partIndex: index, text: normalizeFindingText(finding.title) };
  }
  return null;
}

export function normalizeFeedbackText(text: unknown): string {
  return normalizeFindingText(typeof text === 'string' ? text : '');
}

export function extractPartsText(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => {
      const p = part as { type?: unknown; text?: unknown };
      return p.type === 'text' && typeof p.text === 'string' ? p.text : '';
    })
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();
}

export type FeedbackPatternStat = {
  pattern: string;
  up: number;
  down: number;
};

export function feedbackPatternOf(text: string): string {
  const normalized = normalizeFeedbackText(text);
  const issue = normalized.match(/问题[:：]\s*(.*?)(?:\s+(?:影响|修复建议)[:：]|$)/)?.[1]?.trim();
  const source = issue || normalized;
  return source
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/\b[\w./-]+\.(?:ts|tsx|js|jsx|vue|css|scss|less|json|md|yml|yaml|prisma|sql|go|py|java|kt|rs|php|rb|sh|Dockerfile)(?::\d+)?\b/g, '')
    .replace(/\b[\w./-]+:\d+\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function collectFeedbackStats(partsList: unknown[]): FeedbackPatternStat[] {
  const stats = new Map<string, FeedbackPatternStat>();
  for (const parts of partsList) {
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (!part || typeof part !== 'object') continue;
      const feedbacks = (part as { findingFeedbacks?: unknown }).findingFeedbacks;
      if (!Array.isArray(feedbacks)) continue;
      for (const item of feedbacks) {
        const entry = item as { text?: unknown; feedback?: unknown };
        if (entry.feedback !== 'up' && entry.feedback !== 'down') continue;
        const pattern = feedbackPatternOf(typeof entry.text === 'string' ? entry.text : '');
        if (!pattern) continue;
        const stat = stats.get(pattern) ?? { pattern, up: 0, down: 0 };
        if (entry.feedback === 'up') stat.up += 1;
        if (entry.feedback === 'down') stat.down += 1;
        stats.set(pattern, stat);
      }
    }
  }
  return Array.from(stats.values()).sort((a, b) => b.up + b.down - (a.up + a.down) || a.pattern.localeCompare(b.pattern));
}

export function buildThresholdFeedbackMemorySection(stats: FeedbackPatternStat[]): string {
  const accepted = stats.filter((stat) => stat.up + stat.down >= feedbackThreshold.minTotal && stat.up - stat.down >= feedbackThreshold.minNet);
  const rejected = stats.filter((stat) => stat.up + stat.down >= feedbackThreshold.minTotal && stat.down - stat.up >= feedbackThreshold.minNet);
  const lines = [feedbackMemoryHeader];
  for (const stat of accepted) {
    lines.push(`- 用户认可的问题模式：${stat.pattern}（赞 ${stat.up} / 踩 ${stat.down} / 净 ${stat.up - stat.down}）`);
  }
  for (const stat of rejected) {
    lines.push(`- 用户否定的问题模式：${stat.pattern}（赞 ${stat.up} / 踩 ${stat.down} / 净 ${stat.up - stat.down}）`);
  }
  return lines.join('\n');
}

export function mergeThresholdFeedbackMemory(current: string | null | undefined, section: string): string {
  const body = (current ?? '').trim();
  const sectionHasEntries = section.split('\n').slice(1).some((line) => line.trim());
  const withoutOldSection = removeMemorySection(removeMemorySection(body, feedbackMemoryHeader), legacyFeedbackMemoryHeader).trim();
  if (!sectionHasEntries) return withoutOldSection;
  return withoutOldSection ? `${withoutOldSection}\n\n${section}` : section;
}

function removeMemorySection(memory: string, header: string): string {
  if (!memory) return '';
  const lines = memory.split('\n');
  const result: string[] = [];
  for (let index = 0; index < lines.length;) {
    if (lines[index].trim() !== header) {
      result.push(lines[index]);
      index += 1;
      continue;
    }
    index += 1;
    while (index < lines.length && !/^##\s+/.test(lines[index])) index += 1;
  }
  return result.join('\n').replace(/\n{3,}/g, '\n\n');
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
