import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import EmbeddedPostgres from 'embedded-postgres';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const executeFile = promisify(execFile);
const directory = resolve('.dev-postgres', `dingtalk-validation-${randomUUID()}`);
const originalEnv = { DATABASE_URL: process.env.DATABASE_URL, TMPDIR: process.env.TMPDIR,
  DINGTALK_WORKER_URL: process.env.DINGTALK_WORKER_URL, DINGTALK_WORKER_TOKEN: process.env.DINGTALK_WORKER_TOKEN };
let postgres: EmbeddedPostgres;
let prisma: typeof import('@server/infrastructure/prisma/prisma.service').prisma;
let notifications: typeof import('../notifications/notifications.service');
let app: Hono;
let messageServices: typeof import('../notifications/dingtalk-messages.service');
let workerServer: ReturnType<typeof serve>;
let cliSendCount = 0;
let lastProfile = '';
let rejectSends = false;
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
  import('../notifications/dingtalk-messages.service'), import('../../platform/dingtalk/cli-worker'),
])).then(([database, settings, repositories, rss, notificationServices, messages, worker]) => {
  prisma = database.prisma;
  notifications = notificationServices;
  messageServices = messages;
  app = new Hono().route('/api/settings', settings.settingsRoutes)
    .route('/api/repositories', repositories.repositoryRoutes).route('/api/rss', rss.rssRoutes);
  process.env.DINGTALK_WORKER_TOKEN = randomUUID();
  const workerApp = worker.createDingtalkWorker(process.env.DINGTALK_WORKER_TOKEN, (input) => {
    lastProfile = input.profile;
    if (input.action === 'search') return Promise.resolve({ people: [{ userId: 'ding-user-1', name: '测试钉钉用户' }], returnedCount: 1 });
    if (input.action === 'status') return Promise.resolve({ authenticated: true, tokenValid: true, userName: '授权用户', corpName: '测试组织', reason: null });
    cliSendCount++;
    if (rejectSends) return Promise.reject(new Error('simulated worker failure'));
    return Promise.resolve({ status: 'accepted' as const, remoteIds: ['test-receipt'] });
  });
  return new Promise<void>((resolve) => {
    workerServer = serve({ fetch: workerApp.fetch, port: 0, hostname: '127.0.0.1' }, (address) => {
      process.env.DINGTALK_WORKER_URL = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
}), 60_000);

afterAll(() => Promise.resolve().then(() => prisma?.$disconnect()).finally(() => postgres?.stop()).finally(() => {
  workerServer?.close();
  for (const name of ['DATABASE_URL', 'TMPDIR', 'DINGTALK_WORKER_URL', 'DINGTALK_WORKER_TOKEN'] as const) {
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

  it('CLI 配置、名单与发送链路隔离组织，并发重复请求只发送一次', async () => {
    const connection = { name: 'CLI 连接', transport: 'cli', cliProfile: 'corp-a:user-a', cliRobotCode: 'test-bot', cliGroupId: 'test-group' };
    await request('/api/settings/dingtalk', 'POST', { name: '缺少 CLI 配置', transport: 'cli' }, 400);
    const { robot } = await request('/api/settings/dingtalk', 'POST', connection, 201);
    expect(robot).toMatchObject({ transport: 'cli', isConfigured: true, hasWebhookUrl: false });
    const cliConfig = await notifications.loadDingtalkConfig(robot.id);
    expect(cliConfig).toMatchObject({ transport: 'cli', cliProfile: connection.cliProfile });
    const notificationCount = cliSendCount;
    await notifications.sendDingtalkNotification(cliConfig, '自动通知', '通知正文');
    expect(cliSendCount).toBe(notificationCount + 1);
    await request(`/api/settings/dingtalk/${robot.id}`, 'PATCH', { cliGroupId: null }, 400);
    await request(`/api/settings/dingtalk/${robot.id}`, 'PATCH', { cliPath: '/bin/sh' }, 400);
    expect((await request(`/api/settings/dingtalk/${robot.id}/status`, 'POST')).status.authenticated).toBe(true);
    const { contact } = await request(`/api/settings/dingtalk/${robot.id}/contacts`, 'POST', { query: '251111', dimension: 'jobNumber', userId: 'ding-user-1' });
    expect(contact).toMatchObject({ employeeNo: '251111', userId: 'ding-user-1', name: '测试钉钉用户' });
    expect(lastProfile).toBe(connection.cliProfile);
    await request(`/api/settings/dingtalk/${robot.id}/contacts`, 'POST', { query: '251111', dimension: 'jobNumber', userId: '914' }, 409);
    await request(`/api/settings/dingtalk/${robot.id}`, 'PATCH', { cliProfile: 'corp-b:user-b' }, 409);
    const session = await prisma.session.create({ data: { kind: 'chat' } });
    const send = { requestId: randomUUID(), connectionId: robot.id, targetKind: 'direct', title: '审查讨论', text: '经用户确认的正文', contactIds: [contact.id], confirmed: true };
    const before = cliSendCount;
    await Promise.all([messageServices.sendSessionDingtalkMessage(session.id, 'admin', send), messageServices.sendSessionDingtalkMessage(session.id, 'admin', send)]);
    expect(cliSendCount - before).toBe(1);
    expect((await messageServices.listDingtalkMessages(session.id))[0]).toMatchObject({ status: 'accepted', recipients: [{ name: contact.name, userId: 'ding-user-1' }] });
    await expect(messageServices.sendSessionDingtalkMessage(session.id, 'admin', { ...send, text: '不同正文' })).rejects.toMatchObject({ status: 409 });
    expect(() => messageServices.sendSessionDingtalkMessage(session.id, 'admin', { ...send, requestId: randomUUID(), confirmed: false })).toThrow();
    rejectSends = true;
    const failedRequest = { ...send, requestId: randomUUID() };
    const beforeFailure = cliSendCount;
    expect(await messageServices.sendSessionDingtalkMessage(session.id, 'admin', failedRequest)).toMatchObject({ status: 'unknown' });
    await messageServices.sendSessionDingtalkMessage(session.id, 'admin', failedRequest);
    expect(cliSendCount - beforeFailure).toBe(1);
    rejectSends = false;
    const pendingId = randomUUID();
    await prisma.dingtalkMessage.create({ data: { id: pendingId, connectionId: robot.id, sessionId: session.id,
      requestedBy: 'admin', payloadHash: 'interrupted-request', targetKind: 'group', recipients: [], title: '中断发送', text: '正文' } });
    await messageServices.recoverDingtalkMessages();
    expect(await prisma.dingtalkMessage.findUniqueOrThrow({ where: { id: pendingId } })).toMatchObject({ status: 'unknown' });
    const other = await request('/api/settings/dingtalk', 'POST', { ...connection, name: '其他组织', cliProfile: 'corp-b:user-b' }, 201);
    await expect(messageServices.sendSessionDingtalkMessage(session.id, 'admin', { ...send, requestId: randomUUID(), connectionId: other.robot.id })).rejects.toMatchObject({ status: 400 });
    await request(`/api/settings/dingtalk/${robot.id}`, 'DELETE', undefined, 409);
    await request(`/api/settings/dingtalk/${robot.id}`, 'PATCH', { enabled: false });
    await expect(notifications.loadDingtalkConfig(robot.id)).rejects.toThrow('停用');
  });
});
