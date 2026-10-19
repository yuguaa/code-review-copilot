import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import EmbeddedPostgres from 'embedded-postgres';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const executeFile = promisify(execFile);
const directory = resolve('.dev-postgres', `dingtalk-validation-${randomUUID()}`);
const originalEnv = { DATABASE_URL: process.env.DATABASE_URL, TMPDIR: process.env.TMPDIR };
let postgres: EmbeddedPostgres;
let prisma: typeof import('@server/infrastructure/prisma/prisma.service').prisma;
let notifications: typeof import('../notifications/notifications.service');
let app: Hono;
const webhookA = `https://robot-a.example.invalid/send?access_token=${randomUUID()}`;
const webhookB = `https://robot-b.example.invalid/send?access_token=${randomUUID()}`;
const secretA = randomUUID();
const secretB = randomUUID();

beforeAll(() => mkdir(directory, { recursive: true }).then(() => {
  process.env.TMPDIR = directory;
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
  process.env.DATABASE_URL = `postgresql://robot_validation:validation@127.0.0.1:${port}/postgres`;
  postgres = new EmbeddedPostgres({ databaseDir: resolve(directory, 'database'), user: 'robot_validation',
    password: 'validation', port, persistent: true, postgresFlags: ['-c', 'unix_socket_directories='] });
  return postgres.initialise().then(() => postgres.start());
}).then(() => executeFile(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
  timeout: 30_000, maxBuffer: 1024 * 1024,
})).then(() => Promise.all([
  import('@server/infrastructure/prisma/prisma.service'), import('./settings.routes'),
  import('../repositories/repositories.routes'), import('../rss/rss.routes'), import('../notifications/notifications.service'),
])).then(([database, settings, repositories, rss, notificationServices]) => {
  prisma = database.prisma;
  notifications = notificationServices;
  app = new Hono().route('/api/settings', settings.settingsRoutes)
    .route('/api/repositories', repositories.repositoryRoutes).route('/api/rss', rss.rssRoutes);
}), 60_000);

afterAll(() => Promise.resolve().then(() => prisma?.$disconnect()).finally(() => postgres?.stop()).finally(() => {
  for (const name of ['DATABASE_URL', 'TMPDIR'] as const) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
}), 60_000);

function request(path: string, method = 'GET', body?: unknown, status = 200) {
  return Promise.resolve(app.request(`http://localhost${path}`, { method,
    headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })).then((response) => {
    expect(response.status).toBe(status);
    return response.json() as Promise<Record<string, any>>;
  }).then((result) => {
    const serialized = JSON.stringify(result);
    for (const credential of [webhookA, webhookB, secretA, secretB]) expect(serialized).not.toContain(credential);
    return result;
  });
}

describe('真实 PostgreSQL 多钉钉机器人', () => {
  it('独立保存凭证，更新一个机器人保留另一个机器人，响应隐藏凭证', () => {
    let firstId: string;
    let secondId: string;
    return request('/api/settings/dingtalk', 'POST', { name: '机器人 A', webhookUrl: webhookA, secret: secretA }, 201)
      .then(({ robot }) => {
        firstId = robot.id;
        expect(robot).toMatchObject({ hasWebhookUrl: true, hasSecret: true, repositoryCount: 0, rssSubscriptionCount: 0 });
        expect(robot).not.toHaveProperty('webhookUrl');
        expect(robot).not.toHaveProperty('secret');
        return request('/api/settings/dingtalk', 'POST', { name: '机器人 B', webhookUrl: webhookB, secret: secretB, enabled: false }, 201);
      }).then(({ robot }) => {
        secondId = robot.id;
        return request(`/api/settings/dingtalk/${firstId}`, 'PATCH', { name: '更新 A', webhookUrl: ' ', secret: '' });
      }).then(() => prisma.dingtalkRobot.findUniqueOrThrow({ where: { id: firstId } }))
      .then((robot) => {
        expect(robot).toMatchObject({ name: '更新 A', webhookUrl: webhookA, secret: secretA });
        return prisma.dingtalkRobot.findUniqueOrThrow({ where: { id: secondId } });
      }).then((robot) => {
        expect(robot).toMatchObject({ name: '机器人 B', webhookUrl: webhookB, secret: secretB, enabled: false });
        return request(`/api/settings/dingtalk/${firstId}`, 'PATCH', { webhookUrl: webhookB, secret: null });
      }).then(({ robot }) => {
        expect(robot.hasSecret).toBe(false);
        return prisma.dingtalkRobot.findUniqueOrThrow({ where: { id: firstId } });
      }).then((robot) => {
        expect(robot.webhookUrl).toBe(webhookB);
        expect(robot.secret).toBeNull();
        return request('/api/settings/dingtalk');
      }).then(({ robots }) => {
        expect(robots).toHaveLength(2);
        return request(`/api/settings/dingtalk/${firstId}`, 'DELETE');
      }).then(() => request(`/api/settings/dingtalk/${secondId}`, 'DELETE'))
      .then(() => expect(prisma.dingtalkRobot.count()).resolves.toBe(0));
  }, 60_000);

  it('仓库与 RSS 明确选择目标，关联计数和删除保护由数据库验证', () => {
    let robotId: string;
    let repositoryId: string;
    let rssId: string;
    return prisma.gitLabAccount.create({ data: { url: 'https://git.example.invalid', accessToken: randomUUID() } })
      .then((account) => request('/api/settings/dingtalk', 'POST', { name: '关联机器人', webhookUrl: webhookA, secret: secretA }, 201)
        .then(({ robot }) => {
          robotId = robot.id;
          const repository = { gitLabAccountId: account.id, gitLabProjectId: 901, name: '审查仓库', path: 'team/repository' };
          return request('/api/repositories', 'POST', { ...repository, enableDingtalk: true }, 400)
            .then(() => request('/api/repositories', 'POST', { ...repository, enableDingtalk: true, dingtalkRobotId: 'missing' }, 400))
            .then(() => request('/api/repositories', 'POST', repository, 200));
        })).then(({ repository }) => {
        repositoryId = repository.id;
        expect(repository.enableDingtalk).toBe(false);
        return request(`/api/repositories/${repositoryId}`, 'PATCH', { enableDingtalk: true, dingtalkRobotId: robotId });
      }).then(() => request('/api/rss/subscriptions', 'POST', { name: '订阅', url: 'https://feed.example.invalid/rss', enabled: true }, 400))
      .then(() => request('/api/rss/subscriptions', 'POST', { name: '订阅', url: 'https://feed.example.invalid/rss', enabled: true, dingtalkRobotId: robotId }))
      .then(({ subscription }) => {
        rssId = subscription.id;
        return request('/api/settings/dingtalk');
      }).then(({ robots }) => {
        expect(robots.find((robot: { id: string }) => robot.id === robotId)).toMatchObject({ repositoryCount: 1, rssSubscriptionCount: 1 });
        return request(`/api/settings/dingtalk/${robotId}`, 'DELETE', undefined, 409);
      }).then(() => notifications.loadRepositoryDingtalkConfig({ enableDingtalk: true, dingtalkRobotId: robotId }))
      .then((config) => {
        expect(config).toEqual({ webhook: webhookA, secret: secretA });
        return request(`/api/settings/dingtalk/${robotId}`, 'PATCH', { enabled: false });
      }).then(() => expect(notifications.loadDingtalkConfig(robotId)).rejects.toThrow('停用'))
      .then(() => expect(notifications.loadDingtalkConfig('missing')).rejects.toThrow('不存在'))
      .then(() => request(`/api/repositories/${repositoryId}`, 'PATCH', { enableDingtalk: true }, 400))
      .then(() => request(`/api/rss/subscriptions/${rssId}`, 'PATCH', { enabled: true }, 400))
      .then(() => request(`/api/settings/dingtalk/${robotId}`, 'DELETE', undefined, 409))
      .then(() => request(`/api/repositories/${repositoryId}`, 'PATCH', { enableDingtalk: false, dingtalkRobotId: null }))
      .then(() => request(`/api/settings/dingtalk/${robotId}`, 'DELETE', undefined, 409))
      .then(() => request(`/api/rss/subscriptions/${rssId}`, 'PATCH', { enabled: false, dingtalkRobotId: null }))
      .then(() => request(`/api/settings/dingtalk/${robotId}`, 'DELETE'))
      .then(() => request(`/api/settings/dingtalk/${robotId}`, 'PATCH', { name: '不存在' }, 404));
  }, 60_000);
});
