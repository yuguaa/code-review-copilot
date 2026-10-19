import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { getAuthConfig } from '../../config/auth.config';
import { prisma } from '../../infrastructure/prisma/prisma.service';

declare module 'hono' {
  interface ContextVariableMap {
    authUsername: string;
  }
}

export const AUTH_COOKIE_NAME = 'code_review_copilot_session';
export const AUTH_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function verifyLoginCredential(username: string, secret: string): boolean {
  const config = getAuthConfig();
  if (!config) return false;
  /* 固定长度摘要交由 Node 的恒定时间比较处理，账号和密码均完成校验。 */
  const usernameMatches = timingSafeEqual(digest(username.trim()), digest(config.username));
  const secretMatches = timingSafeEqual(digest(secret), digest(config.secret));
  return usernameMatches && secretMatches;
}

export function createAuthSession(username: string): Promise<string> {
  const config = getAuthConfig();
  if (!config || username !== config.username) return Promise.reject(new Error('认证配置无效'));
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  return prisma.$transaction([
    prisma.authSession.deleteMany({ where: { expiresAt: { lte: now } } }),
    prisma.authSession.create({ data: {
      id: randomUUID(), tokenHash: hashSessionToken(token), username,
      expiresAt: new Date(now.getTime() + AUTH_SESSION_MAX_AGE_SECONDS * 1000), createdAt: now,
    } }),
  ]).then(() => token);
}

export function getAuthSession(token: string | undefined): Promise<{ username: string } | null> {
  const config = getAuthConfig();
  if (!config || !token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return Promise.resolve(null);
  return prisma.authSession.findUnique({ where: { tokenHash: hashSessionToken(token) } }).then((session) => {
    if (!session || session.expiresAt <= new Date() || session.username !== config.username) return null;
    return { username: session.username };
  });
}

export function revokeAuthSession(token: string | undefined): Promise<void> {
  if (!token || !getAuthConfig()) return Promise.resolve();
  return prisma.authSession.deleteMany({ where: { tokenHash: hashSessionToken(token) } }).then(() => undefined);
}

export function isSameOriginRequest(request: Request): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(process.env.APP_PUBLIC_URL || request.url).origin;
}

export function shouldUseSecureAuthCookie(request: Request): boolean {
  return new URL(process.env.APP_PUBLIC_URL || request.url).protocol === 'https:';
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function hashSessionToken(token: string): string {
  const config = getAuthConfig();
  if (!config) throw new Error('认证环境变量未完整配置');
  /* 修改登录凭证或会话密钥后，已有会话立即失效。数据库仅保存摘要。 */
  return createHmac('sha256', config.sessionSecret)
    .update(config.username).update('\0').update(config.secret).update('\0').update(token).digest('hex');
}
