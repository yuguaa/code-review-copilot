import { HTTPException } from 'hono/http-exception';

import { prisma } from '@server/infrastructure/prisma/prisma.service';

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

export function sendSessionDingtalkMessage(_sessionId: string, _requestedBy: string, _body: unknown): Promise<never> {
  return Promise.reject(new HTTPException(410, { message: '继续对话中的钉钉私聊已停用，请使用审查报告的机器人群通知' }));
}
