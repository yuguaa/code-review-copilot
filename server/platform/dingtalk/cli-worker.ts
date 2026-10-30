import { createHash, timingSafeEqual } from 'node:crypto';

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { dingtalkCliRequest } from '@shared/dingtalk';
import { runDws } from './cli-runtime';

export function createDingtalkWorker(token: string, execute = runDws) {
  if (token.length < 32) throw new Error('DINGTALK_WORKER_TOKEN 至少需要 32 个字符');
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const app = new Hono();
  app.get('/healthz', (c) => c.text('ok'));
  app.use('/execute', (c, next) => {
    if (!timingSafeEqual(digest(c.req.header('authorization') ?? ''), digest(`Bearer ${token}`))) return Promise.resolve(c.json({ error: '未授权' }, 401));
    return next();
  });
  app.use('/execute', bodyLimit({ maxSize: 256 * 1024 }));
  app.post('/execute', (c) => c.req.json().then<Response>((body) => {
    const parsed = dingtalkCliRequest.safeParse(body);
    if (!parsed.success) return c.json({ error: 'DWS 请求参数无效' }, 400);
    if (parsed.data.action === 'send' && !parsed.data.groupId && !parsed.data.userIds.length) return c.json({ error: '缺少收件人' }, 400);
    return execute(parsed.data).then((result) => c.json(result));
  }));
  app.onError((error, c) => c.json({ error: error.message.startsWith('DWS 调用失败：')
    ? error.message : 'DWS 返回无效或执行失败，请检查授权和命令版本' }, 502));
  return app;
}
