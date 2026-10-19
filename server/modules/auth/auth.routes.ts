import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';

import { getMissingAuthEnv } from '../../config/auth.config';
import {
  AUTH_COOKIE_NAME, AUTH_SESSION_MAX_AGE_SECONDS, createAuthSession, isSameOriginRequest,
  revokeAuthSession, shouldUseSecureAuthCookie, verifyLoginCredential,
} from './auth.service';

export const authRoutes = new Hono();

const loginSchema = z.object({ username: z.string().trim().min(1).max(256), secret: z.string().min(1).max(4096) });

authRoutes.post('/login', (c) => {
  if (getMissingAuthEnv().length) return c.json({ error: '认证环境变量未完整配置' }, 500);
  if (!isSameOriginRequest(c.req.raw)) return c.json({ error: '请求来源无效' }, 403);
  c.header('Cache-Control', 'no-store');
  return c.req.json().then<Response, Response>((body: unknown) => {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: '登录请求无效' }, 400);
    const { username, secret } = parsed.data;
    if (!verifyLoginCredential(username, secret)) return c.json({ error: '账号或密码不正确' }, 401);
    return revokeAuthSession(getCookie(c, AUTH_COOKIE_NAME)).then(() => createAuthSession(username)).then((token) => {
      setCookie(c, AUTH_COOKIE_NAME, token, {
        path: '/', httpOnly: true, sameSite: 'Lax', secure: shouldUseSecureAuthCookie(c.req.raw),
        maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
      });
      return c.json({ success: true, username });
    });
  }, () => c.json({ error: '登录请求无效' }, 400));
});

authRoutes.post('/logout', (c) => revokeAuthSession(getCookie(c, AUTH_COOKIE_NAME)).then(() => {
  deleteCookie(c, AUTH_COOKIE_NAME, { path: '/', httpOnly: true, sameSite: 'Lax', secure: shouldUseSecureAuthCookie(c.req.raw) });
  return c.json({ success: true });
}));

authRoutes.get('/me', (c) => c.json({ authenticated: true, username: c.get('authUsername') }));
