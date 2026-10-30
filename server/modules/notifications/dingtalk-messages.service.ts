import { createHash } from 'node:crypto';

import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import { dingtalkText } from '@shared/dingtalk';
import { prisma } from '@server/infrastructure/prisma/prisma.service';
import { sendDingtalk } from '@server/shared/dingtalk/dingtalk.service';
import { loadDingtalkConfig } from './notifications.service';

const sendInput = z.object({ requestId: z.string().uuid(), connectionId: z.string().min(1),
  contactIds: z.array(z.string().min(1)).max(20).transform((ids) => [...new Set(ids)].sort()),
  targetKind: z.enum(['group', 'direct']), title: z.string().trim().min(1).max(200), text: dingtalkText,
  confirmed: z.literal(true),
}).strict();
const messageSelect = { id: true, connectionId: true, targetKind: true, recipients: true, title: true,
  status: true, remoteIds: true, error: true, createdAt: true, requestedBy: true } as const;

export function listDingtalkMessages(sessionId: string) {
  return prisma.dingtalkMessage.findMany({ where: { sessionId }, select: messageSelect, orderBy: { createdAt: 'desc' }, take: 50 });
}

export function recoverDingtalkMessages() {
  return prisma.dingtalkMessage.updateMany({ where: { status: 'sending' }, data: {
    status: 'unknown', error: '服务重新启动，发送结果需要核对；不会自动重发。',
  } });
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
      .then(() => loadDingtalkConfig(input.connectionId)).then((config) => {
        if (config.transport !== 'cli') throw new HTTPException(400, { message: '问答发消息请选择钉钉 CLI 连接' });
        if (input.targetKind === 'direct' && !input.contactIds.length) throw new HTTPException(400, { message: '私聊必须选择收件人' });
        return prisma.dingtalkContact.findMany({ where: { id: { in: input.contactIds }, connectionId: input.connectionId, enabled: true } })
          .then((contacts) => {
            if (contacts.length !== input.contactIds.length) throw new HTTPException(400, { message: '收件人不属于此连接或已停用，请重新选择' });
            return prisma.dingtalkMessage.create({ data: {
              id: input.requestId, sessionId, requestedBy, payloadHash, connectionId: input.connectionId,
              targetKind: input.targetKind, title: input.title, text: input.text,
              recipients: contacts.map(({ userId, name, employeeNo }) => ({ userId, name, employeeNo })),
            } }).then(() => sendDingtalk(config, input.title, input.text, {
              userIds: contacts.map((contact) => contact.userId), direct: input.targetKind === 'direct',
            }).then((receipt) => prisma.dingtalkMessage.update({ where: { id: input.requestId }, select: messageSelect,
              data: { status: 'accepted', remoteIds: receipt.remoteIds },
            }), () => prisma.dingtalkMessage.update({ where: { id: input.requestId }, select: messageSelect, data: {
              status: 'unknown', error: '发送结果无法确认，请检查钉钉后再决定是否新建发送请求。不会自动重发。',
            } })), (error: unknown) => {
              if ((error as { code?: string }).code !== 'P2002') throw error;
              return prisma.dingtalkMessage.findUniqueOrThrow({ where: { id: input.requestId } }).then((message) => {
                if (message.payloadHash !== payloadHash) throw new HTTPException(409, { message: '发送请求 ID 已被其他内容使用' });
                return prisma.dingtalkMessage.findUniqueOrThrow({ where: { id: message.id }, select: messageSelect });
              });
            });
          });
      });
  });
}
