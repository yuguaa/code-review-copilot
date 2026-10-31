import axios from 'axios';
import crypto from 'node:crypto';
import { z } from 'zod';

import { callDingtalkCli } from './dingtalk-cli.service';

export function dingtalkDestinationFingerprint(config: DingtalkConfig): string {
  const destination = config.transport === 'cli' ? [config.cliProfile, config.cliRobotCode, config.cliGroupId] : [config.webhook, config.secret ?? null];
  return crypto.createHash('sha256').update(JSON.stringify(destination)).digest('hex');
}

/** 钉钉加签：sign = base64(HMAC-SHA256(secret, `${ts}\n${secret}`))，拼到 URL。 */
export function signedUrl(webhook: string, secret?: string | null): string {
  if (!secret) return webhook;
  const ts = Date.now();
  const sign = crypto.createHmac('sha256', secret).update(`${ts}\n${secret}`).digest('base64');
  const sep = webhook.includes('?') ? '&' : '?';
  return `${webhook}${sep}timestamp=${ts}&sign=${encodeURIComponent(sign)}`;
}

/**
 * 推送 markdown 消息到钉钉自定义机器人。
 * 接口错误统一抛出，由调用方快速失败；不在此处兜底降级。
 */
export function sendDingtalk(config: DingtalkConfig, title: string, text: string,
  target: { userIds: string[]; direct?: boolean } = { userIds: [] }): Promise<{ remoteIds: string[] }> {
  if (target.direct) return Promise.reject(new Error('钉钉审查通知仅支持机器人群消息，不支持私聊'));
  if (config.transport === 'cli') {
    return callDingtalkCli({ action: 'send', profile: config.cliProfile, robotCode: config.cliRobotCode,
      groupId: config.cliGroupId, userIds: target.userIds, title, text,
    }).then((body) => z.object({ status: z.literal('accepted'), remoteIds: z.array(z.string()) }).parse(body));
  }
  const mentions = target.userIds.length ? target.userIds.map((id) => `@${id}`).join(' ') + '\n\n' : '';
  const url = signedUrl(config.webhook, config.secret);
  return axios
    .post(url, { msgtype: 'markdown', markdown: { title, text: mentions + text },
      ...(target.userIds.length ? { at: { atUserIds: target.userIds, isAtAll: false } } : {}),
    }, { timeout: 10_000, maxRedirects: 0 })
    .then((res) => {
      const data = z.object({ errcode: z.number().int() }).parse(res.data);
      if (data.errcode !== 0) throw new Error(`钉钉发送失败：${data.errcode}`);
      return { remoteIds: [] };
    });
}

export type DingtalkConfig = { transport?: 'webhook'; webhook: string; secret?: string | null }
  | { transport: 'cli'; cliProfile: string; cliRobotCode: string; cliGroupId: string };
