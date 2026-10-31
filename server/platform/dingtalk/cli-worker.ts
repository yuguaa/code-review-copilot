import { createHash, timingSafeEqual } from 'node:crypto';

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { dingtalkAuthStatus, dingtalkCliRequest } from '@shared/dingtalk';
import { runDws } from './cli-runtime';
import { createDwsLoginManager } from './cli-login';

export function createDingtalkWorker(token: string, execute = runDws, login = createDwsLoginManager()) {
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
    if (parsed.data.action === 'login-start') return c.json(login.start());
    if (parsed.data.action === 'login-state') return c.json(login.state());
    if (parsed.data.action === 'login-cancel') return login.cancel(parsed.data.loginId).then((state) => c.json(state));
    const generation = login.state()?.id;
    const loginChanged = () => login.state()?.status === 'pending' || login.state()?.id !== generation;
    if (parsed.data.action === 'auth-status') {
      const unavailable = { authenticated: false, tokenValid: false, profile: null, userName: null, corpName: null, reason: 'login_changed' };
      if (loginChanged()) return c.json(unavailable);
      return execute(parsed.data).then((result) => c.json(loginChanged() ? unavailable : result));
    }
    if (parsed.data.action === 'send-user') {
      /* 保留旧协议的 410，明确告知调用方私聊已停用，不能恢复执行。 */
      return c.json({ error: '个人私聊已停用，审查通知只在仓库配置的机器人群中 @ 提交人' }, 410);
    }
    if (parsed.data.action === 'send' && !parsed.data.groupId) return c.json({ error: '审查通知仅支持机器人群消息' }, 400);
    if (loginChanged()) return c.json({ error: '正在扫码登录，请完成授权后重试' }, 409);
    const request = parsed.data;
    return execute({ action: 'auth-status' }).then((result) => {
      const auth = dingtalkAuthStatus.parse(result);
      if (loginChanged() || !auth.authenticated || !auth.tokenValid || auth.profile !== request.profile) {
        return c.json({ error: '登录身份已变化或未完成授权，请刷新后重试' }, 409);
      }
      return execute(request).then((body) => {
        /* 已进入发送命令的请求保留真实回执，不能以身份变化伪装成未发送。 */
        if (request.action !== 'send' && request.action !== 'message-user' && loginChanged()) return c.json({ error: '登录身份已变化，请重新查询人员' }, 409);
        return c.json(body);
      });
    });
  }));
  app.onError((error, c) => c.json({ error: error.message.startsWith('DWS 调用失败：')
    ? error.message : 'DWS 返回无效或执行失败，请检查授权和命令版本' }, 502));
  return app;
}
