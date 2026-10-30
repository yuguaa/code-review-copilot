import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import type { Hono } from 'hono';

export function verifyPlatformRequests(context: VerificationContext): Promise<void> {
  const { app, prisma, check, secrets, signal, username, password, baseSha, headSha } = context;
  const credential = () => {
    const value = randomBytes(24).toString('hex');
    secrets.push(value);
    return value;
  };
  let cookie = '';
  let accountId: string;
  let modelId: string;
  let repositoryId: string;
  let subscriptionId: string;
  let sessionId: string;
  let firstRunId: string;
  let robotId: string;
  const modelSecret = credential();
  const nextModelSecret = credential();
  const accessToken = credential();
  const nextAccessToken = credential();
  const webhookSecret = credential();
  const repositorySecret = credential();
  const nextRepositorySecret = credential();
  const notificationSecret = credential();
  const repositoryWebhook = `https://notification.example.invalid/robot?access_token=${credential()}`;

  const request = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}, status = 200) => {
    signal.throwIfAborted();
    return Promise.resolve(app.request(`http://localhost${path}`, {
      method, signal, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })).then((response) => {
      assert.equal(response.status, status, `${method} ${path} 响应状态不符合预期`);
      return response;
    });
  };
  const json = (response: Response): Promise<Record<string, any>> => response.json().then((body) => {
    assert.ok(body && typeof body === 'object', '接口必须返回 JSON 对象');
    const text = JSON.stringify(body);
    assert.ok(secrets.every((secret) => !text.includes(secret)), 'API 响应包含敏感配置');
    return body;
  });
  const login = (previous?: string) => request('/api/auth/login', 'POST', { username, secret: password }, { Cookie: previous ?? '' }).then((response) => {
    const setCookie = response.headers.get('set-cookie');
    assert.ok(setCookie, '登录响应缺少 Cookie');
    assert.ok(setCookie.includes('HttpOnly') && setCookie.includes('SameSite=Lax'), '认证 Cookie 缺少保护属性');
    const value = setCookie.split(';')[0];
    secrets.push(value, value.slice(value.indexOf('=') + 1));
    return value;
  });
  const event = { project: { id: 101 }, ref: 'refs/heads/main', before: baseSha, after: headSha, checkout_sha: headSha, user_name: 'Platform Verification', user_username: '251111', user_id: 914 };
  const sendWebhook = () => request('/api/webhook/gitlab', 'POST', event, { Cookie: '', 'X-Gitlab-Event': 'Push Hook', 'X-Gitlab-Token': webhookSecret }).then(json);
  const ignoredWebhook = () => request('/api/webhook/gitlab', 'POST', { ...event, ref: 'refs/heads/not-watched' }, {
    Cookie: '', 'X-Gitlab-Event': 'Push Hook', 'X-Gitlab-Token': webhookSecret,
  }).then(json);

  return check('应用健康与 API、遥测认证', () => request('/healthz').then((response) => response.text()).then((text) => {
    assert.equal(text, 'ok');
    return Promise.all(['/api/auth/me', '/api/runs', '/api/repositories', '/api/settings/models', '/api/rss/subscriptions', '/api/sessions', '/observability/', '/observability/api/user'].map((path) =>
      request(path, 'GET', undefined, { Cookie: '', 'X-WEBAUTH-USER': username, Authorization: 'Bearer verification' }, 401)));
  }).then(() => undefined))
    .then(() => check('错误密码与跨来源登录拒绝', () => request('/api/auth/login', 'POST', { username, secret: credential() }, {}, 401)
      .then(() => request('/api/auth/login', 'POST', { username, secret: password }, { Origin: 'https://external.example.invalid' }, 403))
      .then(() => undefined)))
    .then(() => check('登录创建服务端摘要会话', () => login().then((value) => {
      cookie = value;
      return request('/api/auth/me').then(json);
    }).then((body) => {
      assert.equal(body.username, username);
      assert.equal(body.authenticated, true);
      return prisma.authSession.findMany();
    }).then((sessions) => {
      assert.equal(sessions.length, 1);
      assert.match(sessions[0].tokenHash, /^[a-f0-9]{64}$/);
      assert.ok(!cookie.includes(sessions[0].tokenHash), '数据库应保存会话摘要');
    })))
    .then(() => check('重新登录撤销旧会话', () => {
      const previous = cookie;
      return login(previous).then((value) => {
        assert.ok(value !== previous, '重新登录必须创建新凭证');
        cookie = value;
        return request('/api/auth/me', 'GET', undefined, { Cookie: previous }, 401);
      }).then(() => undefined);
    }))
    .then(() => check('模型配置创建、读取与凭证保留更新', () => request('/api/settings/models', 'POST', {
      provider: 'openai-compatible', modelId: 'verification-config-only', apiKey: modelSecret,
      apiBaseUrl: 'https://model.example.invalid/v1', isDefault: true,
    }).then(json).then(({ model }) => {
      modelId = model.id;
      assert.equal(model.hasApiKey, true);
      return request(`/api/settings/models/${modelId}`).then(json);
    }).then(() => request(`/api/settings/models/${modelId}`, 'PATCH', { apiKey: '', maxSteps: 9 }).then(json))
      .then(() => prisma.aIModel.findUniqueOrThrow({ where: { id: modelId } }))
      .then((model) => {
        assert.ok(model.apiKey === modelSecret, '留空必须保留模型凭证');
        assert.equal(model.maxSteps, 9);
        return request(`/api/settings/models/${modelId}`, 'PATCH', { apiKey: nextModelSecret }).then(json);
      }).then(() => prisma.aIModel.findUniqueOrThrow({ where: { id: modelId } }))
      .then((model) => assert.ok(model.apiKey === nextModelSecret, '模型凭证没有更新'))))
    .then(() => check('GitLab 配置创建、读取和凭证更新清除', () => request('/api/settings/gitlab', 'POST', {
      url: 'https://gitlab.example.invalid', accessToken, webhookSecret,
    }).then(json).then(({ account }) => {
      accountId = account.id;
      assert.equal(account.hasAccessToken, true);
      return request('/api/settings/gitlab').then(json);
    }).then(() => request(`/api/settings/gitlab/${accountId}`, 'PATCH', { accessToken: '', webhookSecret: '' }).then(json))
      .then(() => prisma.gitLabAccount.findUniqueOrThrow({ where: { id: accountId } }))
      .then((account) => {
        assert.ok(account.accessToken === accessToken && account.webhookSecret === webhookSecret, '留空必须保留 GitLab 凭证');
        return request(`/api/settings/gitlab/${accountId}`, 'PATCH', { webhookSecret: null }, {}, 400)
          .then(() => request(`/api/settings/gitlab/${accountId}`, 'PATCH', { accessToken: nextAccessToken, webhookSecret: null, isActive: false }).then(json));
      }).then(({ account }) => {
        assert.equal(account.hasWebhookSecret, false);
        return prisma.gitLabAccount.findUniqueOrThrow({ where: { id: accountId } });
      }).then((account) => {
        assert.ok(account.accessToken === nextAccessToken && account.webhookSecret === null, 'GitLab 凭证更新或清除失败');
        return request(`/api/settings/gitlab/${accountId}`, 'PATCH', { webhookSecret, isActive: true }).then(json);
      }).then(() => undefined)))
    .then(() => check('仓库配置与自定义模型、通知凭证', () => request('/api/repositories', 'POST', {
      gitLabAccountId: accountId, gitLabProjectId: 101, name: '平台集成验证', path: 'verification/platform',
      defaultAIModelId: modelId, customProvider: 'openai-compatible', customModelId: 'verification-config-only',
      customApiKey: repositorySecret, customApiBaseUrl: 'https://model.example.invalid/v1',
      enableDingtalk: false, enableMrComment: false, watchBranches: 'main',
    }).then(json).then(({ repository }) => {
      repositoryId = repository.id;
      assert.equal(repository.ocrConcurrency, 2);
      assert.equal(repository.ocrTimeoutMinutes, 10);
      assert.equal(repository.ocrMaxTokensBudget, 2_000_000);
      assert.equal(repository.hasCustomApiKey, true);
      return request('/api/repositories').then(json);
    }).then(() => request(`/api/repositories/${repositoryId}`, 'PATCH', { name: '平台验证更新', customApiKey: '' }).then(json))
      .then(() => prisma.repository.findUniqueOrThrow({ where: { id: repositoryId } }))
      .then((repository) => {
        assert.ok(repository.customApiKey === repositorySecret, '留空必须保留仓库凭证');
        return request(`/api/repositories/${repositoryId}`, 'PATCH', { customApiKey: nextRepositorySecret, ocrConcurrency: 3 }).then(json);
      }).then(() => prisma.repository.findUniqueOrThrow({ where: { id: repositoryId } }))
      .then((repository) => {
        assert.ok(repository.customApiKey === nextRepositorySecret, '仓库模型凭证没有更新');
        return request(`/api/repositories/${repositoryId}`, 'PATCH', {
          customProvider: null, customModelId: null, customApiKey: null, customApiBaseUrl: null,
          customMaxSteps: null,
        }).then(json);
      }).then(({ repository }) => {
        assert.equal(repository.hasCustomApiKey, false);
      })))
    .then(() => check('机器人凭证保留、更新和清除', () => request('/api/settings/dingtalk', 'POST', {
      name: '验证机器人', enabled: false, webhookUrl: repositoryWebhook, secret: notificationSecret,
    }, {}, 201).then(json).then(({ robot }) => {
      robotId = robot.id;
      assert.equal(robot.hasWebhookUrl, true);
      return request(`/api/settings/dingtalk/${robotId}`, 'PATCH', { secret: '', webhookUrl: '' }).then(json);
    }).then(() => prisma.dingtalkRobot.findUniqueOrThrow({ where: { id: robotId } }))
      .then((robot) => {
        assert.ok(robot.secret === notificationSecret && robot.webhookUrl === repositoryWebhook, '机器人凭证没有保留');
        return request(`/api/settings/dingtalk/${robotId}`, 'PATCH', { secret: nextRepositorySecret }).then(json);
      }).then(() => prisma.dingtalkRobot.findUniqueOrThrow({ where: { id: robotId } }))
      .then((robot) => {
        assert.ok(robot.secret === nextRepositorySecret, '机器人凭证没有更新');
        return request(`/api/settings/dingtalk/${robotId}`, 'PATCH', { secret: null }).then(json);
      }).then(({ robot }) => {
        assert.equal(robot.hasSecret, false);
        assert.equal(robot.hasWebhookUrl, true);
      })))
    .then(() => check('RSS 配置创建、读取与更新', () => request('/api/rss/subscriptions', 'POST', {
      name: '验证订阅', url: 'https://rss.example.invalid/feed.xml', enabled: false, intervalMinutes: 30,
    }).then(json).then(({ subscription }) => {
      subscriptionId = subscription.id;
      assert.equal(subscription.pushedCount, 0);
      return request('/api/rss/subscriptions').then(json);
    }).then(() => request(`/api/rss/subscriptions/${subscriptionId}`, 'PATCH', { name: '验证订阅更新', intervalMinutes: 15 }).then(json))
      .then(({ subscription }) => {
        assert.equal(subscription.intervalMinutes, 15);
        assert.equal(subscription.enabled, false);
        return prisma.rssSubscription.findUniqueOrThrow({ where: { id: subscriptionId } });
      }).then((subscription) => assert.equal(subscription.name, '验证订阅更新'))))
    .then(() => check('配置输入、同源写入和重复记录校验', () => Promise.all([
      request(`/api/repositories/${repositoryId}`, 'PATCH', { ocrConcurrency: 0 }, {}, 400),
      request(`/api/repositories/${repositoryId}`, 'PATCH', { ocrMaxTokensBudget: 1.5 }, {}, 400),
      request(`/api/repositories/${repositoryId}`, 'PATCH', { ocrMaxTokensBudget: 0 }).then(json),
      request(`/api/rss/subscriptions/${subscriptionId}`, 'PATCH', { intervalMinutes: 0 }, {}, 400),
      request(`/api/settings/models/${modelId}`, 'PATCH', { provider: 'unsupported' }, {}, 400),
      request('/api/rss/subscriptions', 'POST', { name: '重复地址', url: 'https://rss.example.invalid/feed.xml', enabled: false }, {}, 409),
      request(`/api/repositories/${repositoryId}`, 'PATCH', { name: '跨来源写入' }, { Origin: 'https://external.example.invalid' }, 403),
    ]).then(() => undefined)))
    .then(() => check('真实 Webhook 路由创建排队 Run', () => ignoredWebhook().then((body) => {
      assert.equal(body.ignored, true);
      assert.match(body.reason, /监听范围/);
      return sendWebhook();
    }).then((body) => {
      assert.equal(body.triggered, true);
      sessionId = body.sessionId;
      return prisma.run.findMany({ where: { sessionId } });
    }).then((runs) => {
      assert.equal(runs.length, 1);
      firstRunId = runs[0].id;
      assert.equal(runs[0].status, 'queued');
      assert.equal(runs[0].baseSha, baseSha);
      assert.equal(runs[0].headSha, headSha);
      assert.equal(runs[0].rawResult, null);
      assert.equal(runs[0].reportMessageId, null);
      assert.ok(runs[0].inputMessageId, 'Run 缺少关联的输入消息');
    })))
    .then(() => check('重复与并发 Webhook 幂等', () => Promise.all([sendWebhook(), sendWebhook(), sendWebhook()]).then((bodies) => {
      assert.ok(bodies.every((body) => body.triggered === false && body.sessionId === sessionId), '重复请求应返回已有会话');
      return Promise.all([prisma.run.count(), prisma.session.count()]);
    }).then(([runs, sessions]) => {
      assert.equal(runs, 1);
      assert.equal(sessions, 1);
      return request(`/api/sessions/${sessionId}/review-command`, 'POST', undefined, {}, 409);
    }).then(() => undefined)))
    .then(() => check('运行与会话读取、无报告状态', () => request('/api/runs').then(json).then(({ runs }) => {
      assert.equal(runs.length, 1);
      assert.equal(runs[0].id, firstRunId);
      assert.equal(Object.hasOwn(runs[0], 'rawResult'), false);
      return request(`/api/runs/${firstRunId}`).then(json);
    }).then(({ run }) => {
      assert.equal(run.reportMessageId, null);
      assert.equal(run.rawResult, null);
      return request(`/api/sessions/${sessionId}`).then(json);
    }).then((body) => {
      assert.equal(body.session.status, 'queued');
      assert.equal(body.runs[0].id, firstRunId);
      assert.equal(body.messages.length, 1);
      assert.equal(body.messages[0].role, 'user');
      assert.equal(body.activeLeafMessageId, body.messages[0].id);
      return request('/api/sessions?kind=review').then(json);
    }).then(({ sessions }) => {
      assert.equal(sessions[0].id, sessionId);
      return prisma.session.findUniqueOrThrow({ where: { id: sessionId }, select: { authorUsername: true } })
        .then((saved) => assert.equal(saved.authorUsername, '251111'));
    })))
    .then(() => check('排队取消与并发重新排队', () => request(`/api/sessions/${sessionId}/stop-review`, 'POST').then(json)
      .then(() => request(`/api/runs/${firstRunId}`).then(json))
      .then(({ run }) => {
        assert.equal(run.status, 'cancelled');
        assert.ok(run.finishedAt, '取消完成应记录结束时间');
        return request(`/api/sessions/${sessionId}/stop-review`, 'POST', undefined, {}, 409);
      }).then(() => Promise.all([0, 1].map(() => app.request(`http://localhost/api/sessions/${sessionId}/review-command`, {
        method: 'POST', headers: { Cookie: cookie }, signal,
      }))))
      .then((responses) => {
        assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
        return prisma.run.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } });
      }).then((runs) => {
        assert.equal(runs.length, 2);
        assert.equal(runs.filter((run) => run.status === 'queued').length, 1);
        assert.equal(runs.find((run) => run.id === firstRunId)?.status, 'cancelled');
        return request(`/api/sessions/${sessionId}/stop-review`, 'POST').then(json);
      }).then(() => request(`/api/sessions/${sessionId}`).then(json))
      .then((body) => {
        assert.equal(body.session.status, 'cancelled');
        assert.equal(body.runs.length, 2);
        assert.ok(body.runs.every((run: { status: string }) => run.status === 'cancelled'));
      })))
    .then(() => check('普通会话与不存在记录的响应', () => request('/api/sessions', 'POST', { title: '验证会话', repositoryId }, {}, 201).then(json)
      .then(({ session }) => request(`/api/sessions/${session.id}`).then(json))
      .then((body) => {
        assert.equal(body.session.kind, 'chat');
        assert.deepEqual(body.messages, []);
        assert.deepEqual(body.runs, []);
        return Promise.all([
          request('/api/runs/verification-missing', 'GET', undefined, {}, 404),
          request('/api/sessions/verification-missing', 'GET', undefined, {}, 404),
        ]);
      }).then(() => undefined)))
    .then(() => check('注销后复制凭证与伪造身份均失效', () => {
      const previous = cookie;
      return request('/api/auth/logout', 'POST').then(json).then(() => Promise.all([
        request('/api/auth/me', 'GET', undefined, { Cookie: previous }, 401),
        request('/api/runs', 'GET', undefined, { Cookie: previous }, 401),
        request('/observability/api/user', 'GET', undefined, { Cookie: previous, 'X-WEBAUTH-USER': username }, 401),
      ])).then(() => prisma.authSession.count()).then((count) => assert.equal(count, 0));
    }))
    .then(() => check('过期会话拒绝访问', () => login().then((value) => {
      cookie = value;
      return prisma.authSession.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    }).then(() => request('/api/auth/me', 'GET', undefined, {}, 401)).then(() => undefined)));
}

export type VerificationContext = {
  app: Hono;
  prisma: PrismaClient;
  check: <T>(name: string, operation: () => Promise<T>) => Promise<T>;
  secrets: string[];
  signal: AbortSignal;
  username: string;
  password: string;
  baseSha: string;
  headSha: string;
  repoDirectory: string;
};
