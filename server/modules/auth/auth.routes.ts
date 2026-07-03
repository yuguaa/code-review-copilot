import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import {
  AUTH_COOKIE_NAME,
  AUTH_SESSION_MAX_AGE_SECONDS,
  createAuthSession,
  getMissingAuthEnv,
  shouldUseSecureAuthCookie,
  verifyLoginCredential,
} from '../../lib/auth';

export const authRoutes = new Hono();

/** 登录：校验单账号 env 凭证，下发 HttpOnly 签名 Cookie。 */
authRoutes.post('/login', async (c) => {
  const missing = getMissingAuthEnv();
  if (missing.length > 0) {
    return c.json({ error: `认证环境变量未完整配置：${missing.join(', ')}` }, 500);
  }

  let body: { username?: unknown; secret?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: '登录请求无效' }, 400);
  }

  const username = typeof body.username === 'string' ? body.username : '';
  const secret = typeof body.secret === 'string' ? body.secret : '';

  if (!verifyLoginCredential(username, secret)) {
    return c.json({ error: '账号或密钥不正确' }, 401);
  }

  const token = await createAuthSession(username.trim());
  const protocol = new URL(c.req.url).protocol;
  setCookie(c, AUTH_COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: shouldUseSecureAuthCookie(c.req.raw.headers, protocol),
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
  });
  return c.json({ success: true, username: username.trim() });
});

/** 登出：清除会话 Cookie。 */
authRoutes.post('/logout', (c) => {
  deleteCookie(c, AUTH_COOKIE_NAME, { path: '/' });
  return c.json({ success: true });
});

/** 探活：能走到这里说明已通过 requireAuth。 */
authRoutes.get('/me', (c) => {
  return c.json({ authenticated: true });
});
