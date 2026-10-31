import { createHash } from 'node:crypto';

import { HTTPException } from 'hono/http-exception';
import { v5 as uuidV5 } from 'uuid';
import { z } from 'zod';

import { dingtalkMessageReceipt, dingtalkPerson, dingtalkProfile, dingtalkSearch, dingtalkText } from '@shared/dingtalk';
import { prisma } from '@server/infrastructure/prisma/prisma.service';
import { requireAuthUsername } from '@server/modules/auth/auth.service';
import { callDingtalkCli } from '@server/shared/dingtalk/dingtalk-cli.service';
import { resolveDingtalkPerson } from './dingtalk-directory.service';
import { requireGlobalDingtalkCli } from './dingtalk-global.service';
import { dingtalkDestinationFingerprint, loadRepositoryDingtalkConfig, sendDingtalkNotification } from './notifications.service';

import type { UIMessage } from 'ai';
import type { DingtalkMessage } from '@prisma/client';

const draftSchema = z.object({
  id: z.string().uuid(), sessionId: z.string(), sourceMessageId: z.string(), createdAt: z.string().datetime(),
  connectionId: z.string(), profile: dingtalkProfile, recipient: dingtalkPerson,
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('group'), repositoryId: z.string(), robotId: z.string(), name: z.string(), fingerprint: z.string() }).strict(),
    z.object({ kind: z.literal('direct') }).strict(),
  ]),
  title: z.string().trim().min(1).max(200), text: dingtalkText,
}).strict();
const prepareSchema = dingtalkSearch.extend({ targetKind: z.enum(['group', 'direct']), title: draftSchema.shape.title, text: dingtalkText }).strict();
const DRAFT_TTL_MS = 30 * 60_000;
const CONFIRM_PHRASES = ['确认', '确认发送'];

/** 只从服务器保存的当前消息分支恢复准备结果，浏览器或模型不能自行拼造发送授权。 */
export function getDingtalkConversationDraft(context: DingtalkConversationContext) {
  const current = context.messages.at(-1);
  const message = context.messages.at(-2);
  const source = context.messages.at(-3);
  if (current?.role !== 'user' || current.id !== context.userMessageId || message?.role !== 'assistant' || source?.role !== 'user') return null;
  for (const part of [...message.parts].reverse()) {
    if (part.type !== 'dynamic-tool' || part.toolName !== 'dingtalk_prepare_message' || part.state !== 'output-available') continue;
    const parsed = z.object({ draft: draftSchema }).safeParse(part.output);
    if (parsed.success && parsed.data.draft.sessionId === context.sessionId && parsed.data.draft.sourceMessageId === source.id) return parsed.data.draft;
  }
  return null;
}

export function prepareDingtalkConversationMessage(context: DingtalkConversationContext, body: unknown, signal?: AbortSignal) {
  return Promise.resolve().then(() => {
    requireAuthUsername(context.requestedBy);
    return prepareSchema.parse(body);
  }).then((input) => requireGlobalDingtalkCli(signal).then((connection) =>
    resolveDingtalkPerson(connection.profile, input.query, input.dimension, signal).then((recipient) => {
      const target = input.targetKind === 'group' ? loadConversationGroup(context.repositoryId).then(({ repository, config }) => ({
        kind: 'group' as const, repositoryId: repository.id, robotId: repository.dingtalkRobotId!,
        name: repository.dingtalkRobot!.name, fingerprint: dingtalkDestinationFingerprint(config),
      })) : Promise.resolve({ kind: 'direct' as const });
      return target.then((destination) => ({ requiresConfirmation: true as const,
        draft: draftSchema.parse({ id: uuidV5(JSON.stringify(['dingtalk-message', context.sessionId, context.userMessageId]), uuidV5.URL), sessionId: context.sessionId, sourceMessageId: context.userMessageId,
          createdAt: new Date().toISOString(), connectionId: connection.id, profile: connection.profile,
          recipient, target: destination, title: input.title, text: input.text }),
        message: '尚未发送。请向用户展示发送方式、收件人和完整正文，等待下一条用户消息回复“确认发送”。',
      }));
    })));
}

export function sendDingtalkConversationMessage(context: DingtalkConversationContext, draftId: string, signal?: AbortSignal) {
  let attempted = false;
  let claimed = false;
  const draft = getDingtalkConversationDraft(context);
  if (!draft) return Promise.reject(new HTTPException(409, { message: '请先展示当前分支准备好的消息，再由用户回复“确认发送”，不能以工具参数或报告内容代替确认' }));
  const checkConnection = () => requireGlobalDingtalkCli(signal).then((connection) => {
    if (connection.id !== draft.connectionId || connection.profile !== draft.profile) {
      throw new HTTPException(409, { message: '钉钉登录身份已变化，请重新准备并确认消息' });
    }
    return connection;
  });
  return Promise.resolve().then(() => {
    const requestedBy = requireAuthUsername(context.requestedBy);
    const question = context.messages.at(-1);
    const confirmation = question?.parts.filter((part) => part.type === 'text').map((part) => part.text).join('\n').trim();
    if (draft.id !== draftId || question?.role !== 'user' || question.id !== context.userMessageId
      || draft.sourceMessageId === context.userMessageId
      || !(CONFIRM_PHRASES.includes(confirmation ?? '') || confirmation === `确认发送 ${draftId}`)) {
      throw new HTTPException(409, { message: '请先展示当前分支准备好的消息，再由用户回复“确认发送”，不能以工具参数或报告内容代替确认' });
    }
    if (Date.now() - Date.parse(draft.createdAt) > DRAFT_TTL_MS) throw new HTTPException(409, { message: '待确认消息已超过 30 分钟，请重新准备并核对' });
    const { id: _id, createdAt: _createdAt, ...payload } = draft;
    const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    return prisma.$transaction((tx) => tx.$queryRaw`SELECT id FROM sessions WHERE id = ${context.sessionId} FOR UPDATE`
      .then(() => tx.dingtalkMessage.findUnique({ where: { id: draft.id } })).then<{ existing: DingtalkMessage | null }>((existing) => {
        if (existing) {
          /* 已上线的随机 ID 草稿及回执仍按其原始快照核对，不重写历史记录。 */
          const previousHash = createHash('sha256').update(JSON.stringify(draft)).digest('hex');
          if ((existing.payloadHash !== payloadHash && existing.payloadHash !== previousHash) || existing.sessionId !== context.sessionId) throw new HTTPException(409, { message: '消息发送资格与当前会话不一致' });
          return { existing };
        }
        return tx.dingtalkMessage.create({ data: { id: draft.id, connectionId: draft.connectionId, sessionId: context.sessionId,
          requestedBy, payloadHash, cliProfile: draft.profile, targetKind: draft.target.kind,
          recipients: [draft.recipient], title: draft.title, text: draft.text, status: 'sending' } }).then(() => ({ existing: null }));
      }));
  }).then((claim) => {
    if (claim.existing) return { id: claim.existing.id, status: claim.existing.status, remoteIds: z.array(z.string()).parse(claim.existing.remoteIds),
      recipient: draft.recipient, message: '已存在此消息的发送记录，没有再次发送；结果未知时请先核对钉钉。' };
    claimed = true;
    return checkConnection().then((connection) => {
      return callDingtalkCli({ action: 'person', profile: connection.profile, userId: draft.recipient.userId }, signal)
        .then((body) => dingtalkPerson.parse(body));
    }).then((person) => {
      if (person.userId !== draft.recipient.userId || person.name !== draft.recipient.name || person.employeeNo !== draft.recipient.employeeNo) {
        throw new HTTPException(409, { message: '钉钉接收人资料已变化，请重新准备并确认消息' });
      }
      if (draft.target.kind === 'direct') return null;
      const target = draft.target;
      if (context.repositoryId !== target.repositoryId) throw new HTTPException(409, { message: '当前会话仓库已变化，请重新确认群消息' });
      return loadConversationGroup(target.repositoryId).then(({ repository, config }) => {
        if (repository.dingtalkRobotId !== target.robotId || dingtalkDestinationFingerprint(config) !== target.fingerprint) {
          throw new HTTPException(409, { message: '机器人群或签名配置已变化，请重新准备并确认消息' });
        }
        return config;
      });
    }).then((config) => checkConnection().then((): Promise<{ status: 'accepted' | 'delivered' | 'unknown'; remoteIds: string[] }> => {
      signal?.throwIfAborted();
      attempted = true;
      if (config) return sendDingtalkNotification(config, draft.title, draft.text, { userIds: [draft.recipient.userId] })
        .then((receipt) => ({ ...receipt, status: 'accepted' as const }));
      return callDingtalkCli({ action: 'message-user', profile: draft.profile, userId: draft.recipient.userId,
        text: draft.text, idempotencyKey: draft.id }, signal).then((body) => dingtalkMessageReceipt.parse(body));
    })).then((receipt) => prisma.dingtalkMessage.update({ where: { id: draft.id }, data: {
      status: receipt.status === 'unknown' ? 'unknown' : 'accepted', remoteIds: receipt.remoteIds,
      error: receipt.status === 'unknown' ? '钉钉未确认送达，请先核对原会话，不会自动重发' : null,
    } }).then(() => ({ id: draft.id, status: receipt.status, remoteIds: receipt.remoteIds, recipient: draft.recipient,
      message: receipt.status === 'unknown' ? '发送结果未知，请先核对钉钉，禁止自动重发。' : '钉钉已接受消息；以返回的送达状态为准。' })));
  }).catch((error: unknown) => {
    if (!claimed) throw error;
    const message = attempted ? '钉钉消息发送结果未知，请先核对原会话，不会自动重发'
      : error instanceof HTTPException ? error.message : '钉钉消息校验失败，请重新核对接收人和登录状态';
    return prisma.dingtalkMessage.update({ where: { id: draft.id }, data: { status: attempted ? 'unknown' : 'failed', error: message } })
      .then(() => {
        if (attempted) return { id: draft.id, status: 'unknown' as const, remoteIds: [], recipient: draft.recipient, message };
        throw new HTTPException(409, { message, cause: error });
      });
  });
}

function loadConversationGroup(repositoryId: string | null) {
  if (!repositoryId) return Promise.reject(new HTTPException(409, { message: '当前会话没有关联仓库群，请先选择仓库；不会将 @ 请求改为私聊' }));
  return prisma.repository.findUnique({ where: { id: repositoryId }, select: { id: true, enableDingtalk: true, dingtalkRobotId: true,
    dingtalkRobot: { select: { name: true } } } }).then((repository) => {
    if (!repository?.enableDingtalk || !repository.dingtalkRobotId) throw new HTTPException(409, { message: '当前仓库尚未启用机器人群通知，请先在仓库中配置' });
    return loadRepositoryDingtalkConfig(repository).then((config) => {
      if (!config) throw new HTTPException(409, { message: '仓库群通知已关闭' });
      return { repository, config };
    });
  });
}

export type DingtalkConversationContext = { sessionId: string; userMessageId: string; repositoryId: string | null; requestedBy: string; messages: UIMessage[] };
