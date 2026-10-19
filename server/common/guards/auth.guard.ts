import { getCookie } from 'hono/cookie';

import { getMissingAuthEnv } from '../../config/auth.config';
import { AUTH_COOKIE_NAME, getAuthSession, isSameOriginRequest } from '../../modules/auth/auth.service';

import type { Context, Next } from 'hono';

export function requireAuth(c: Context, next: Next): Promise<Response | void> {
  const path = c.req.path;
  if (path === '/api/auth/login' || path === '/api/webhook' || path.startsWith('/api/webhook/')) return next();
  if (getMissingAuthEnv().length) return Promise.resolve(c.json({ error: '认证环境变量未完整配置' }, 500));
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !isSameOriginRequest(c.req.raw)) {
    return Promise.resolve(c.json({ error: '请求来源无效' }, 403));
  }
  return getAuthSession(getCookie(c, AUTH_COOKIE_NAME)).then<Response | void>((session) => {
    if (!session) return c.json({ error: '未登录或会话已失效' }, 401);
    c.set('authUsername', session.username);
    c.header('Cache-Control', 'no-store');
    return next();
  });
}
