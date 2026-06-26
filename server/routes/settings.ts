import { Hono } from 'hono';
import { prisma } from '../lib/prisma';
import { createGitLabService } from '../lib/gitlab';

export const settingsRoutes = new Hono();

function maskAccount(a: { accessToken?: string; webhookSecret?: string | null; [k: string]: unknown }) {
  const { accessToken, webhookSecret, ...rest } = a;
  return { ...rest, hasAccessToken: Boolean(accessToken), hasWebhookSecret: Boolean(webhookSecret) };
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
