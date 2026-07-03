import { Hono } from 'hono';
import {
  createRepository,
  deleteRepository,
  listRepositories,
  listRepositoryBranches,
  listRepositoryCapabilities,
  updateRepository,
} from '../modules/repositories/repositories.service';

export const repositoryRoutes = new Hono();

repositoryRoutes.get('/', async (c) => {
  return c.json({ repositories: await listRepositories() });
});

repositoryRoutes.post('/', async (c) => {
  const body = await c.req.json();
  return c.json({ repository: await createRepository(body) });
});

repositoryRoutes.patch('/:id', async (c) => {
  const body = await c.req.json();
  return c.json({ repository: await updateRepository(c.req.param('id'), body) });
});

repositoryRoutes.delete('/:id', async (c) => {
  return c.json(await deleteRepository(c.req.param('id')));
});

/** 列出仓库分支（配置 watchBranches 时辅助）。 */
repositoryRoutes.get('/:id/branches', async (c) => {
  const branches = await listRepositoryBranches(c.req.param('id'));
  if (!branches) return c.json({ error: '仓库不存在' }, 404);
  return c.json({ branches });
});

repositoryRoutes.get('/:id/capabilities', async (c) => {
  const capabilities = await listRepositoryCapabilities(c.req.param('id'));
  if (!capabilities) return c.json({ error: '仓库不存在' }, 404);
  return c.json(capabilities);
});
