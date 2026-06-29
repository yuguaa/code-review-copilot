import axios from 'axios';
import crypto from 'node:crypto';
import { createLogger } from './logger';

const log = createLogger('dingtalk');

export type DingtalkConfig = {
  webhook: string;
  secret?: string | null;
};

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
export function sendDingtalk(config: DingtalkConfig, title: string, text: string): Promise<void> {
  const url = signedUrl(config.webhook, config.secret);
  return axios
    .post(url, { msgtype: 'markdown', markdown: { title, text } }, { timeout: 10_000 })
    .then((res) => {
      const data = res.data as { errcode?: number; errmsg?: string };
      if (data.errcode && data.errcode !== 0) {
        throw new Error(`钉钉推送失败：${data.errcode} ${data.errmsg ?? ''}`);
      }
      log.info('钉钉推送成功');
    });
}
