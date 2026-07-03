import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import {
  AUTH_COOKIE_NAME,
  isClientIpAllowed,
  isAuthConfigured,
  verifyAuthSession,
} from '../../modules/auth/auth.service';

/** 放行的公开路径前缀：登录接口 + webhook（webhook 用 GitLab 签名自校验，不走 Cookie）。 */
const PUBLIC_PREFIXES = ['/api/auth/login', '/api/webhook'];

function isPublicPath(path: string): boolean {
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * 全局鉴权守卫（硬要求：所有 /api/* 必过）。
 *
 * 顺序：公开路径放行 → IP 白名单 → Cookie 会话签名。
 * 任一不过：IP 不在白名单 403，未登录/会话无效 401。
 */
export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  const path = c.req.path;
  if (isPublicPath(path)) {
    return next();
  }

  if (!isAuthConfigured()) {
    return c.json({ error: '认证环境变量未完整配置（APP_AUTH_USERNAME/SECRET/SESSION_SECRET）' }, 500);
  }

  const headers = c.req.raw.headers;
  if (!isClientIpAllowed(headers)) {
    return c.json({ error: '来源 IP 不在白名单' }, 403);
  }

  const token = getCookie(c, AUTH_COOKIE_NAME);
  const ok = await verifyAuthSession(token);
  if (!ok) {
    return c.json({ error: '未登录或会话已失效' }, 401);
  }

  return next();
}
