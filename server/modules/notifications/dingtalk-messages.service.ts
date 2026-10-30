import { createHash } from 'node:crypto';

import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import { dingtalkId, dingtalkMessageDraft, dingtalkProfile, dingtalkSearch } from '@shared/dingtalk';
import { prisma } from '@server/infrastructure/prisma/prisma.service';
import { requireGlobalDingtalkCli } from './dingtalk-global.service';
import { saveDingtalkContact } from './dingtalk-directory.service';
import { callDingtalkCli } from '@server/shared/dingtalk/dingtalk-cli.service';

const sendInput = dingtalkMessageDraft.extend({ profile: dingtalkProfile, requestId: z.string().uuid(), confirmed: z.literal(true) });
const messageSelect = { id: true, connectionId: true, targetKind: true, recipients: true, title: true,
  status: true, remoteIds: true, error: true, createdAt: true, requestedBy: true, cliProfile: true } as const;

export function listDingtalkMessages(sessionId: string) {
  return prisma.dingtalkMessage.findMany({ where: { sessionId }, select: messageSelect, orderBy: { createdAt: 'desc' }, take: 50 });
}

export function recoverDingtalkMessages() {
  return prisma.dingtalkMessage.updateMany({ where: { status: 'sending' }, data: {
    status: 'unknown', error: '服务重新启动，发送结果需要核对；不会自动重发。',
  } });
}

export function prepareDingtalkMessageDraft(body: unknown, signal?: AbortSignal) {
  const { recipient, ...input } = dingtalkMessageDraft.extend({ contactIds: z.array(z.string()).max(20).default([]),
    recipient: dingtalkSearch.extend({ userId: dingtalkId }).optional() }).parse(body);
  return requireGlobalDingtalkCli(signal).then((global) => {
    if (input.connectionId !== global.id) throw new HTTPException(400, { message: '只能使用平台共享 CLI 连接' });
    if (input.profile && input.profile !== global.profile) throw new HTTPException(409, { message: '登录身份已变化，请重新确认草稿' });
    if (recipient && input.contactIds.length) throw new HTTPException(400, { message: '不能同时指定查询候选和缓存收件人' });
    const resolve = recipient ? saveDingtalkContact(input.connectionId, recipient, signal).then((contact) => [contact.id]) : Promise.resolve(input.contactIds);
    return resolve.then((ids) => {
      input.contactIds = ids;
      if (input.targetKind !== 'direct' || ids.length !== 1) throw new HTTPException(400, { message: '共享 CLI 仅支持向一个已核实收件人私聊' });
      return prisma.dingtalkContact.findMany({ where: { id: { in: ids }, connectionId: input.connectionId, cliProfile: global.profile, enabled: true } });
    })
      .then((contacts) => {
        if (contacts.length !== input.contactIds.length) throw new HTTPException(400, { message: '收件人不属于此连接或已停用，请重新选择' });
        return { input: { ...input, profile: global.profile }, global, contacts };
      });
  });
}

export function sendSessionDingtalkMessage(sessionId: string, requestedBy: string, body: unknown) {
  const input = sendInput.parse(body);
  const payloadHash = createHash('sha256').update(JSON.stringify({ sessionId, requestedBy, ...input })).digest('hex');
  return prisma.dingtalkMessage.findUnique({ where: { id: input.requestId } }).then((existing) => {
    if (existing) {
      if (existing.payloadHash !== payloadHash) throw new HTTPException(409, { message: '发送请求 ID 已被其他内容使用' });
      return prisma.dingtalkMessage.findUniqueOrThrow({ where: { id: existing.id }, select: messageSelect });
    }
    return prisma.session.findUniqueOrThrow({ where: { id: sessionId }, select: { id: true } })
      .then(() => prepareDingtalkMessageDraft({ connectionId: input.connectionId, contactIds: input.contactIds,
        targetKind: input.targetKind, title: input.title, text: input.text, profile: input.profile })).then(({ global, contacts }) =>
        prisma.dingtalkMessage.create({ data: {
          id: input.requestId, sessionId, requestedBy, payloadHash, connectionId: input.connectionId,
          targetKind: input.targetKind, title: input.title, text: input.text,
          cliProfile: global.profile,
          recipients: contacts.map(({ userId, name, employeeNo }) => ({ userId, name, employeeNo })),
        } }).then(() => callDingtalkCli({ action: 'send-user', profile: global.profile, userId: contacts[0].userId,
          title: input.title, text: input.text, idempotencyKey: input.requestId,
        }).then((body) => z.object({ status: z.literal('accepted'), remoteIds: z.array(z.string().min(1)).min(1) }).parse(body)).then((receipt) => prisma.dingtalkMessage.update({ where: { id: input.requestId }, select: messageSelect,
          data: { status: 'accepted', remoteIds: receipt.remoteIds },
        }), () => prisma.dingtalkMessage.update({ where: { id: input.requestId }, select: messageSelect, data: {
          status: 'unknown', error: '发送结果无法确认，请检查钉钉后再决定是否新建发送请求。不会自动重发。',
        } })), (error: unknown) => {
          if ((error as { code?: string }).code !== 'P2002') throw error;
          return prisma.dingtalkMessage.findUniqueOrThrow({ where: { id: input.requestId } }).then((message) => {
            if (message.payloadHash !== payloadHash) throw new HTTPException(409, { message: '发送请求 ID 已被其他内容使用' });
            return prisma.dingtalkMessage.findUniqueOrThrow({ where: { id: message.id }, select: messageSelect });
          });
        }));
  });
}
