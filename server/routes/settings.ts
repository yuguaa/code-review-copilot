import { Hono } from 'hono';
import { prisma } from '../lib/prisma';
import { createGitLabService } from '../lib/gitlab';
import { getCapabilityCatalog, syncBuiltinCapabilities } from '../agent/capabilities';

export const settingsRoutes = new Hono();

function maskAccount(a: { accessToken?: string; webhookSecret?: string | null; [k: string]: unknown }) {
  const { accessToken, webhookSecret, ...rest } = a;
  return { ...rest, hasAccessToken: Boolean(accessToken), hasWebhookSecret: Boolean(webhookSecret) };
}

function maskModel(m: { apiKey?: string; [k: string]: unknown }) {
  const { apiKey, ...rest } = m;
  return { ...rest, hasApiKey: Boolean(apiKey) };
}

function maskNotification(n: { dingtalkSecret?: string | null; [k: string]: unknown } | null) {
  return {
    dingtalkEnabled: n?.dingtalkEnabled ?? false,
    dingtalkWebhookUrl: n?.dingtalkWebhookUrl ?? null,
    hasDingtalkSecret: Boolean(n?.dingtalkSecret),
  };
}

/** GitLab 账号列表。 */
settingsRoutes.get('/gitlab', async (c) => {
  const accounts = await prisma.gitLabAccount.findMany({ orderBy: { createdAt: 'desc' } });
  return c.json({ accounts: accounts.map(maskAccount) });
});

/** 新增 GitLab 账号。 */
settingsRoutes.post('/gitlab', async (c) => {
  const b = await c.req.json();
  const account = await prisma.gitLabAccount.create({
    data: { url: b.url, accessToken: b.accessToken, webhookSecret: b.webhookSecret ?? null },
  });
  return c.json({ account: maskAccount(account) });
});

settingsRoutes.patch('/gitlab/:id', async (c) => {
  const id = c.req.param('id');
  const b = await c.req.json();
  const data: Record<string, unknown> = {};
  if (b.url !== undefined) data.url = b.url;
  if (b.webhookSecret !== undefined) data.webhookSecret = b.webhookSecret;
  if (b.isActive !== undefined) data.isActive = b.isActive;
  if (typeof b.accessToken === 'string' && b.accessToken.length > 0) data.accessToken = b.accessToken;
  const account = await prisma.gitLabAccount.update({ where: { id }, data });
  return c.json({ account: maskAccount(account) });
});

settingsRoutes.delete('/gitlab/:id', async (c) => {
  await prisma.gitLabAccount.delete({ where: { id: c.req.param('id') } }).catch(() => undefined);
  return c.json({ success: true });
});

/** 测试 GitLab 连接。 */
settingsRoutes.post('/gitlab/:id/test', async (c) => {
  const account = await prisma.gitLabAccount.findUnique({ where: { id: c.req.param('id') } });
  if (!account) return c.json({ error: '账号不存在' }, 404);
  const gitlab = createGitLabService(account.url, account.accessToken);
  const ok = await gitlab.testConnection().catch(() => false);
  return c.json({ ok });
});

/** 列出该账号下的 GitLab 项目（新增仓库时选择）。 */
settingsRoutes.get('/gitlab/:id/projects', async (c) => {
  const account = await prisma.gitLabAccount.findUnique({ where: { id: c.req.param('id') } });
  if (!account) return c.json({ error: '账号不存在' }, 404);
  const gitlab = createGitLabService(account.url, account.accessToken);
  const projects = await gitlab.getProjects(c.req.query('search'), { membership: true, per_page: 50 });
  return c.json({
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      path: p.path_with_namespace,
      defaultBranch: p.default_branch,
    })),
  });
});

/** 全局 AI 模型列表。 */
settingsRoutes.get('/models', async (c) => {
  const models = await prisma.aIModel.findMany({ orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }] });
  return c.json({ models: models.map(maskModel) });
});

/** 全局通知配置。 */
settingsRoutes.get('/notification', async (c) => {
  const setting = await prisma.notificationSetting.findUnique({ where: { scope: 'global' } });
  return c.json({ notification: maskNotification(setting) });
});

settingsRoutes.patch('/notification', async (c) => {
  const b = await c.req.json();
  const data: Record<string, unknown> = {};
  if (b.dingtalkEnabled !== undefined) data.dingtalkEnabled = b.dingtalkEnabled;
  if (b.dingtalkWebhookUrl !== undefined) data.dingtalkWebhookUrl = b.dingtalkWebhookUrl || null;
  if (typeof b.dingtalkSecret === 'string' && b.dingtalkSecret.length > 0) data.dingtalkSecret = b.dingtalkSecret;
  const setting = await prisma.notificationSetting.upsert({
    where: { scope: 'global' },
    create: {
      scope: 'global',
      dingtalkEnabled: Boolean(data.dingtalkEnabled),
      dingtalkWebhookUrl: typeof data.dingtalkWebhookUrl === 'string' ? data.dingtalkWebhookUrl : null,
      dingtalkSecret: typeof data.dingtalkSecret === 'string' ? data.dingtalkSecret : null,
    },
    update: data,
  });
  return c.json({ notification: maskNotification(setting) });
});

/** 系统配置与审查数据概览。 */
settingsRoutes.get('/stats', async (c) => {
  const [
    repositoryCount,
    activeRepositoryCount,
    modelCount,
    gitLabAccountCount,
    sessionCount,
    reviewSessionCount,
    chatSessionCount,
    messageCount,
    latestSession,
  ] = await prisma.$transaction([
    prisma.repository.count(),
    prisma.repository.count({ where: { isActive: true } }),
    prisma.aIModel.count({ where: { isActive: true } }),
    prisma.gitLabAccount.count({ where: { isActive: true } }),
    prisma.session.count(),
    prisma.session.count({ where: { kind: 'review' } }),
    prisma.session.count({ where: { kind: 'chat' } }),
    prisma.message.count(),
    prisma.session.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
  ]);
  return c.json({
    stats: {
      repositoryCount,
      activeRepositoryCount,
      modelCount,
      gitLabAccountCount,
      sessionCount,
      reviewSessionCount,
      chatSessionCount,
      messageCount,
      latestSessionAt: latestSession?.updatedAt ?? null,
    },
  });
});

/** 新增全局 AI 模型。 */
settingsRoutes.post('/models', async (c) => {
  const b = await c.req.json();
  const model = await prisma.$transaction(async (tx) => {
    if (b.isDefault === true) {
      await tx.aIModel.updateMany({ data: { isDefault: false } });
    }
    return tx.aIModel.create({
      data: {
        provider: b.provider,
        modelId: b.modelId,
        apiKey: b.apiKey,
        apiBaseUrl: b.apiBaseUrl || null,
        maxSteps: b.maxSteps ?? 16,
        isDefault: b.isDefault ?? false,
        isActive: b.isActive ?? true,
      },
    });
  });
  return c.json({ model: maskModel(model) });
});

settingsRoutes.patch('/models/:id', async (c) => {
  const id = c.req.param('id');
  const b = await c.req.json();
  const model = await prisma.$transaction(async (tx) => {
    if (b.isDefault === true) {
      await tx.aIModel.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
    }
    const data: Record<string, unknown> = {};
    for (const k of ['provider', 'modelId', 'apiBaseUrl', 'maxSteps', 'isDefault', 'isActive']) {
      if (b[k] !== undefined) data[k] = b[k];
    }
    if (typeof b.apiKey === 'string' && b.apiKey.length > 0) data.apiKey = b.apiKey;
    return tx.aIModel.update({ where: { id }, data });
  });
  return c.json({ model: maskModel(model) });
});

settingsRoutes.delete('/models/:id', async (c) => {
  await prisma.aIModel.delete({ where: { id: c.req.param('id') } }).catch(() => undefined);
  return c.json({ success: true });
});

settingsRoutes.get('/capabilities', async (c) => {
  const catalog = await getCapabilityCatalog();
  return c.json({
    tools: catalog.tools.map((item) => ({
      id: item.id,
      key: item.key,
      name: item.name,
      description: item.description,
      category: item.category,
      defaultEnabled: item.defaultEnabled,
      builtin: item.builtin,
      isActive: item.isActive,
    })),
    skills: catalog.skills.map((item) => ({
      id: item.id,
      key: item.key,
      name: item.name,
      description: item.description,
      mode: item.mode,
      defaultEnabled: item.defaultEnabled,
      builtin: item.builtin,
      isActive: item.isActive,
    })),
  });
});

settingsRoutes.patch('/capabilities', async (c) => {
  await syncBuiltinCapabilities();
  const b = await c.req.json();
  await prisma.$transaction(async (tx) => {
    for (const item of (Array.isArray(b.tools) ? b.tools : []) as Array<{ key?: string; defaultEnabled?: boolean; isActive?: boolean }>) {
      if (!item.key) continue;
      await tx.agentTool.update({
        where: { key: item.key },
        data: {
          ...(item.defaultEnabled !== undefined ? { defaultEnabled: item.defaultEnabled } : {}),
          ...(item.isActive !== undefined ? { isActive: item.isActive } : {}),
        },
      });
    }
    for (const item of (Array.isArray(b.skills) ? b.skills : []) as Array<{ key?: string; defaultEnabled?: boolean; isActive?: boolean }>) {
      if (!item.key) continue;
      await tx.agentSkill.update({
        where: { key: item.key },
        data: {
          ...(item.defaultEnabled !== undefined ? { defaultEnabled: item.defaultEnabled } : {}),
          ...(item.isActive !== undefined ? { isActive: item.isActive } : {}),
        },
      });
    }
  });
  const catalog = await getCapabilityCatalog();
  return c.json({ tools: catalog.tools, skills: catalog.skills });
});
