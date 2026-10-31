import { consumeStream, createUIMessageStream, createUIMessageStreamResponse, safeValidateUIMessages } from 'ai';
import { HTTPException } from 'hono/http-exception';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { prisma } from '@server/infrastructure/prisma/prisma.service';
import { requireAuthUsername } from '@server/modules/auth/auth.service';
import { loadActiveModelConfig, loadGlobalDefaultModel, resolveGlobalModelConfig, resolveRepositoryModelConfig } from '@server/modules/ai-models/ai-models.service';
import { publishSessionError, publishSessionListChanged, publishSessionMessages } from '@server/modules/sessions/session-events.service';
import { busySessionStatuses, isSessionBusy } from '@server/modules/sessions/session-lifecycle.service';
import { buildPathIds, buildSessionMessageTree, deriveChatTitle, loadSessionMessageTree, lockSession } from '@server/modules/sessions/session-message-store.service';
import { claimChatSession } from '@server/platform/chat/chat-runtime';
import { createChatStream } from '@server/platform/chat/chat-stream';
import { createLogger } from '@server/shared/logger/logger.service';

import type { Prisma, Run } from '@prisma/client';
import type { UIMessage } from 'ai';

const log = createLogger('chat');
const chatRequestSchema = z.object({
  sessionId: z.string().min(1).max(200),
  messages: z.array(z.unknown()).min(1).max(1000),
  id: z.string().min(1).max(500).optional(),
  trigger: z.enum(["submit-message", "regenerate-message"]).optional(),
  messageId: z.string().min(1).max(200).optional(),
  aiModelId: z.string().trim().min(1).max(200).optional(),
  runId: z.string().min(1).max(200).optional(),
}).strict();

/** 浏览器历史仅参与传输；本轮最后一条用户文本通过 SDK 校验后单独保存。 */
export function validateChatRequest(value: unknown): Promise<ChatRequest> {
  const parsed = chatRequestSchema.safeParse(value);
  if (!parsed.success) return Promise.reject(new HTTPException(400, { message: parsed.error.issues[0].message }));
  return safeValidateUIMessages({ messages: [parsed.data.messages.at(-1)] }).then((validation) => {
    if (!validation.success) throw new HTTPException(400, { message: '本轮消息格式无效', cause: validation.error });
    const userMessage = validation.data[0];
    if (userMessage.role !== 'user' || !userMessage.id || userMessage.id.length > 200
      || !userMessage.parts.length || userMessage.parts.some((part) => part.type !== 'text')
      || !userMessage.parts.some((part) => part.type === 'text' && part.text.trim())
      || userMessage.parts.reduce((size, part) => size + (part.type === 'text' ? part.text.length : 0), 0) > 100_000) {
      throw new HTTPException(400, { message: '本轮消息必须包含有效用户文本' });
    }
    const { messages: _messages, ...request } = parsed.data;
    return { ...request, userMessage: { id: userMessage.id, role: 'user', parts: userMessage.parts } };
  });
}

export function acceptChatTurn(body: ChatRequest) {
  return prisma.$transaction((transaction) => lockSession(transaction, body.sessionId)
    .then(() => Promise.all([
      transaction.session.findUniqueOrThrow({
        where: { id: body.sessionId },
        include: { repository: { include: { gitLabAccount: true, defaultAIModel: true } } },
      }),
      transaction.message.findMany({ where: { sessionId: body.sessionId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      transaction.message.findUnique({ where: { id: body.userMessage.id }, select: { id: true } }),
      transaction.run.findMany({ where: { sessionId: body.sessionId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    ]))
    .then(([session, rows, duplicate, runs]) => {
      if (isSessionBusy(session.status) || runs.some((run) => isSessionBusy(run.status))) {
        throw new HTTPException(409, { message: '当前审查正在执行，请等待任务结束' });
      }
      if (duplicate) throw new HTTPException(409, { message: '消息 ID 已被使用' });
      const parentId = buildSessionMessageTree(rows, session.activeLeafMessageId).activeLeafMessageId;
      const pathIds = buildPathIds(rows, parentId);
      const run = selectChatRun(runs, body.runId, session.repositoryId);
      const byId = new Map(rows.map((row) => [row.id, row]));
      const messages: UIMessage[] = pathIds.map((id) => {
        const row = byId.get(id)!;
        return { id, role: row.role as UIMessage['role'], parts: row.parts as UIMessage['parts'] };
      });
      messages.push(body.userMessage);
      const title = session.kind === 'chat' && !session.title ? deriveChatTitle(messages) : session.title;
      return transaction.message.create({ data: {
        id: body.userMessage.id,
        sessionId: session.id,
        parentId,
        role: 'user',
        parts: body.userMessage.parts as Prisma.InputJsonValue,
      } })
        .then(() => transaction.session.update({ where: { id: session.id }, data: { title, activeLeafMessageId: body.userMessage.id } }))
        .then(() => ({ session, run, messages, userMessage: body.userMessage }));
    }));
}

export function selectChatRun(runs: Run[], runId: string | undefined, repositoryId: string | null): Run | null {
  const selected = runId ? runs.find((run) => run.id === runId) : runs[0];
  if (runId && !selected) throw new HTTPException(404, { message: '运行记录不存在于当前会话' });
  if (!selected) return null;
  if (selected.repositoryId !== repositoryId) throw new HTTPException(409, { message: '运行记录与会话仓库不一致' });
  return selected;
}

export function persistChatResponse(sessionId: string, userMessageId: string, responseId: string, message: UIMessage): Promise<void> {
  if (message.id !== responseId || message.role !== 'assistant') return Promise.reject(new Error('模型回答消息 ID 或角色无效'));
  if (!message.parts.length) return Promise.resolve();
  return prisma.$transaction((transaction) => lockSession(transaction, sessionId)
    .then(() => Promise.all([
      transaction.message.findUnique({ where: { id: userMessageId } }),
      transaction.message.findUnique({ where: { id: responseId } }),
    ]))
    .then(([parent, existing]) => {
      if (!parent || parent.sessionId !== sessionId || parent.role !== 'user') throw new Error('回答父消息不存在于当前会话');
      if (existing && (existing.sessionId !== sessionId || existing.parentId !== userMessageId || existing.role !== 'assistant')) {
        throw new Error('回答消息 ID 已被使用');
      }
      return transaction.message.upsert({
        where: { id: responseId },
        create: { id: responseId, sessionId, parentId: userMessageId, role: 'assistant', parts: message.parts as Prisma.InputJsonValue },
        update: { parts: message.parts as Prisma.InputJsonValue },
      });
    })
    .then(() => transaction.session.updateMany({
      where: { id: sessionId, status: { notIn: [...busySessionStatuses] }, activeLeafMessageId: { in: [userMessageId, responseId] } },
      data: { activeLeafMessageId: responseId, updatedAt: new Date() },
    }))
    .then(() => undefined));
}

export async function prepareChatStream(value: unknown, requestedBy: string): Promise<Response> {
  requestedBy = requireAuthUsername(requestedBy);
  return validateChatRequest(value).then((body) => {
    const controller = new AbortController();
    const release = claimChatSession(body.sessionId, () => controller.abort(new Error("服务正在关闭")));
    const responseId = randomUUID();
    let modelApiKey: string | undefined;
    const reportError = (error: unknown) => {
      const original = error instanceof Error ? error.message : String(error);
      const message = modelApiKey ? original.replaceAll(modelApiKey, '[REDACTED]') : original;
      log.error('对话生成失败', { sessionId: body.sessionId, error: message });
      publishSessionError(body.sessionId, message);
      return message;
    };
    return (body.aiModelId ? loadActiveModelConfig(body.aiModelId).then((model) => {
      if (!model) throw new HTTPException(400, { message: '所选模型不存在或已停用' });
      return model;
    }) : Promise.resolve(null))
      .then((selectedModel) => acceptChatTurn(body).then((turn) =>
        (selectedModel ? Promise.resolve(selectedModel) : loadGlobalDefaultModel().then((globalModel) => turn.session.repository
          ? resolveRepositoryModelConfig(turn.session.repository, globalModel) : resolveGlobalModelConfig(globalModel)))
          .then((modelConfig) => {
            modelApiKey = modelConfig.apiKey.trim();
            publishSessionListChanged();
            const report = turn.run?.reportMessageId
              ? prisma.message.findFirst({
                where: { id: turn.run.reportMessageId, sessionId: body.sessionId, role: 'assistant' },
                select: { parts: true },
              }).then((message) => {
                if (!message) return null;
                return Array.isArray(message.parts)
                  ? message.parts.flatMap((part) =>
                    part && typeof part === 'object' && 'type' in part && part.type === 'text' && 'text' in part && typeof part.text === 'string'
                      ? [part.text] : []).join('\n\n')
                  : null;
              })
              : Promise.resolve(null);
            return report.then((reportText) => createChatStream({
              ...turn,
              report: reportText,
              modelConfig,
              abortSignal: controller.signal,
              requestedBy,
            })).then((stream) => {
              const save = (message: UIMessage) => persistChatResponse(body.sessionId, turn.userMessage.id, responseId, message)
                .catch((error: unknown) => { controller.abort(error); throw error; });
              const messageStream = createUIMessageStream({
                originalMessages: turn.messages,
                generateId: () => responseId,
                execute: ({ writer }) => stream(writer),
                onError: reportError,
                onStepEnd: ({ responseMessage }) => save(responseMessage),
                onEnd: ({ responseMessage }) => save(responseMessage)
                  .then(() => loadSessionMessageTree(body.sessionId))
                  .then((tree) => { publishSessionMessages(body.sessionId, tree); publishSessionListChanged(); })
                  .finally(release),
              });
              return createUIMessageStreamResponse({
                stream: messageStream,
                consumeSseStream: ({ stream: sse }) => consumeStream({ stream: sse, onError: reportError }).finally(release),
              });
            });
          })))
      .catch((error: unknown) => { release(); throw error; });
  });
}

export type ChatRequest = Omit<z.infer<typeof chatRequestSchema>, 'messages'> & { userMessage: UIMessage };
