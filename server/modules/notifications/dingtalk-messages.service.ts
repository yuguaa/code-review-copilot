import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import { dingtalkId, dingtalkMessageDraft, dingtalkSearch } from '@shared/dingtalk';
import { prisma } from '@server/infrastructure/prisma/prisma.service';
import { requireGlobalDingtalkCli } from './dingtalk-global.service';
import { saveDingtalkContact } from './dingtalk-directory.service';
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

export function sendSessionDingtalkMessage(_sessionId: string, _requestedBy: string, _body: unknown): Promise<never> {
  return Promise.reject(new HTTPException(410, { message: '继续对话中的钉钉私聊已停用，请使用审查报告的机器人群通知' }));
}
