import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

import EmbeddedPostgres from 'embedded-postgres';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let app: Hono;
let prisma: typeof import('../../infrastructure/prisma/prisma.service').prisma;
let postgres: EmbeddedPostgres;
const originalEnv = { ...process.env };
const directory = resolve('.dev-postgres', `auth-validation-${randomUUID()}`);

beforeAll(() => mkdir(directory, { recursive: true }).then(() => {
  process.env.TMPDIR = directory;
  process.env.APP_AUTH_USERNAME = 'validation-user';
  process.env.APP_AUTH_SECRET = '验证密码 🔐 ';
  process.env.APP_AUTH_SESSION_SECRET = randomUUID();
  process.env.APP_PUBLIC_URL = 'http://localhost';
  return new Promise<number>((accept, reject) => {
    const listener = createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address();
      if (!address || typeof address === 'string') return reject(new Error('无法取得测试端口'));
      listener.close((error) => error ? reject(error) : accept(address.port));
    });
  });
}).then((port) => {
  process.env.DATABASE_URL = `postgresql://auth_validation:validation@localhost:${port}/postgres`;
  postgres = new EmbeddedPostgres({
    databaseDir: resolve(directory, 'database'), user: 'auth_validation', password: 'validation', port, persistent: true,
    postgresFlags: ['-c', 'unix_socket_directories='],
  });
  return postgres.initialise().then(() => postgres.start());
}).then(() => import('../../infrastructure/prisma/prisma.service')).then((database) => {
  prisma = database.prisma;
  return prisma.$executeRaw`CREATE TABLE "auth_sessions" (
    "id" TEXT PRIMARY KEY, "tokenHash" TEXT NOT NULL UNIQUE, "username" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`;
}).then(() => Promise.all([
  import('./auth.routes'), import('../../common/guards/auth.guard'), import('../../platform/telemetry/observability.routes'),
])).then(([{ authRoutes }, { requireAuth }, { observabilityRoutes }]) => {
  app = new Hono();
  app.use('/api/*', requireAuth);
  app.route('/api/auth', authRoutes);
  app.route('/observability', observabilityRoutes);
}), 60_000);

afterAll(() => Promise.resolve().then(() => prisma?.$disconnect()).finally(() => postgres?.stop()).finally(() => {
  for (const name of ['TMPDIR', 'DATABASE_URL', 'APP_AUTH_USERNAME', 'APP_AUTH_SECRET', 'APP_AUTH_SESSION_SECRET', 'APP_PUBLIC_URL']) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
}), 60_000);

function login(cookie?: string): Promise<Response> {
  return Promise.resolve(app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ username: 'validation-user', secret: '验证密码 🔐 ' }),
  }));
}

function sessionCookie(response: Response): string {
  const cookie = response.headers.get('set-cookie');
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Lax');
  return cookie!.split(';')[0];
}

describe('认证使用真实 PostgreSQL 会话', () => {
  it('登录保存摘要并返回当前账号，退出撤销复制的 Cookie', () => login().then((response) => {
    expect(response.status).toBe(200);
    const cookie = sessionCookie(response);
    return prisma.authSession.findMany().then((sessions) => {
      expect(sessions).toHaveLength(1);
      expect(sessions[0].tokenHash).not.toContain(cookie.split('=')[1]);
      expect(sessions[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
      return app.request('/api/auth/me', { headers: { Cookie: cookie } });
    }).then((me) => me.json()).then((me) => {
      expect(me).toEqual({ authenticated: true, username: 'validation-user' });
      return app.request('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie } });
    }).then((logout) => {
      expect(logout.status).toBe(200);
      return app.request('/api/auth/me', { headers: { Cookie: cookie } });
    }).then((me) => {
      expect(me.status).toBe(401);
      return app.request('/observability/api/user', { headers: { Cookie: cookie, 'X-WEBAUTH-USER': 'admin', Authorization: 'Bearer copied' } });
    }).then((observability) => expect(observability.status).toBe(401));
  }));

  it('重新登录撤销原 Cookie，过期凭证失效', () => login().then((response) => {
    const previous = sessionCookie(response);
    return login(previous).then((second) => {
      const current = sessionCookie(second);
      expect(current).not.toBe(previous);
      return Promise.resolve(app.request('/api/auth/me', { headers: { Cookie: previous } })).then((me) => {
        expect(me.status).toBe(401);
        return prisma.authSession.updateMany({ data: { expiresAt: new Date(0) } });
      }).then(() => app.request('/api/auth/me', { headers: { Cookie: current } }))
        .then((me) => expect(me.status).toBe(401));
    });
  }));

  it('密码验证保留空格并接受 Unicode，错误请求返回明确状态', () => Promise.all([
    app.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }),
    app.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'validation-user', secret: '验证密码 🔐' }) }),
    app.request('/api/auth/login', { method: 'POST', headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' }, body: '{}' }),
    app.request('/api/auth/login/anything', { method: 'POST' }),
    app.request('/observability/api/user', { headers: { 'X-WEBAUTH-USER': 'admin', Cookie: 'grafana_session=other' } }),
  ]).then((responses) => expect(responses.map((response) => response.status)).toEqual([400, 401, 403, 401, 401])));

  it('修改会话密钥后撤销原登录凭证', () => login().then((response) => {
    const cookie = sessionCookie(response);
    const secret = process.env.APP_AUTH_SESSION_SECRET;
    process.env.APP_AUTH_SESSION_SECRET = randomUUID();
    return Promise.resolve(app.request('/api/auth/me', { headers: { Cookie: cookie } }))
      .then((me) => expect(me.status).toBe(401))
      .finally(() => { process.env.APP_AUTH_SESSION_SECRET = secret; });
  }));

  it('拒绝跨来源的会话撤销并保护数据库中的会话', () => login().then((response) => {
    const cookie = sessionCookie(response);
    return Promise.resolve(app.request('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://other.example' } }))
      .then((logout) => {
        expect(logout.status).toBe(403);
        return app.request('/api/auth/me', { headers: { Cookie: cookie } });
      }).then((me) => expect(me.status).toBe(200));
  }));
});
