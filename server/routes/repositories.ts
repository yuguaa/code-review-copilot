import { Hono } from 'hono';
import { prisma } from '../lib/prisma';
import { createGitLabService } from '../lib/gitlab';

export const repositoryRoutes = new Hono();

/** 不回传敏感字段 apiKey（列表查询里 gitLabAccount 仅含 id/url，不含 token）。 */
function maskRepo<T extends { apiKey?: string }>(r: T) {
  const { apiKey, ...rest } = r;
  return { ...rest, hasApiKey: Boolean(apiKey) };
}

repositoryRoutes.get('/', async (c) => {
  const repos = await prisma.repository.findMany({
    orderBy: { updatedAt: 'desc' },
    include: { gitLabAccount: { select: { id: true, url: true } } },
  });
  return c.json({ repositories: repos.map(maskRepo) });
});

repositoryRoutes.post('/', async (c) => {
  const b = await c.req.json();
  const repo = await prisma.repository.create({
    data: {
      gitLabAccountId: b.gitLabAccountId,
      gitLabProjectId: Number(b.gitLabProjectId),
      name: b.name,
      path: b.path,
      description: b.description ?? null,
      watchBranches: b.watchBranches ?? null,
      autoReview: b.autoReview ?? true,
      modelProvider: b.modelProvider,
      modelId: b.modelId,
      apiKey: b.apiKey,
      apiBaseUrl: b.apiBaseUrl ?? null,
      maxSteps: b.maxSteps ?? 16,
      defaultReviewPrompt: b.defaultReviewPrompt ?? null,
      enableMrComment: b.enableMrComment ?? true,
      enableDingtalk: b.enableDingtalk ?? false,
      dingtalkWebhook: b.dingtalkWebhook || null,
      dingtalkSecret: b.dingtalkSecret || null,
    },
  });
  return c.json({ repository: maskRepo(repo) });
});

repositoryRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const b = await c.req.json();
  // 只更新传入的字段；apiKey 为空串时不覆盖
  const data: Record<string, unknown> = {};
  for (const k of [
    'name', 'path', 'description', 'watchBranches', 'autoReview',
    'modelProvider', 'modelId', 'apiBaseUrl', 'maxSteps', 'defaultReviewPrompt', 'isActive',
    'enableMrComment', 'enableDingtalk', 'dingtalkWebhook', 'dingtalkSecret',
  ]) {
    if (b[k] !== undefined) data[k] = b[k];
  }
  if (typeof b.apiKey === 'string' && b.apiKey.length > 0) data.apiKey = b.apiKey;
  const repo = await prisma.repository.update({ where: { id }, data });
  return c.json({ repository: maskRepo(repo) });
});

repositoryRoutes.delete('/:id', async (c) => {
  await prisma.repository.delete({ where: { id: c.req.param('id') } }).catch(() => undefined);
  return c.json({ success: true });
});

/** 列出仓库分支（配置 watchBranches 时辅助）。 */
repositoryRoutes.get('/:id/branches', async (c) => {
  const repo = await prisma.repository.findUnique({
    where: { id: c.req.param('id') },
    include: { gitLabAccount: true },
  });
  if (!repo) return c.json({ error: '仓库不存在' }, 404);
  const gitlab = createGitLabService(repo.gitLabAccount.url, repo.gitLabAccount.accessToken);
  const branches = await gitlab.getBranches(repo.gitLabProjectId, { per_page: 100 });
  return c.json({ branches: branches.map((b) => b.name) });
});
