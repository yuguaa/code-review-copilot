import { Hono } from 'hono';
import { createAIModel, deleteAIModel, listAIModels, updateAIModel } from '../modules/settings/ai-model-settings.service';
import { listCapabilities, updateCapabilities } from '../modules/settings/capabilities-settings.service';
import {
  createGitLabAccount,
  deleteGitLabAccount,
  listGitLabAccounts,
  listGitLabProjects,
  testGitLabAccount,
  updateGitLabAccount,
} from '../modules/settings/gitlab-account-settings.service';
import { loadNotificationSetting, updateNotificationSetting } from '../modules/settings/notification-settings.service';
import { loadSettingsStats } from '../modules/settings/settings-overview.service';

export const settingsRoutes = new Hono();

/** GitLab 账号列表。 */
settingsRoutes.get('/gitlab', async (c) => {
  return c.json({ accounts: await listGitLabAccounts() });
});

/** 新增 GitLab 账号。 */
settingsRoutes.post('/gitlab', async (c) => {
  const body = await c.req.json();
  return c.json({ account: await createGitLabAccount(body) });
});

settingsRoutes.patch('/gitlab/:id', async (c) => {
  const body = await c.req.json();
  return c.json({ account: await updateGitLabAccount(c.req.param('id'), body) });
});

settingsRoutes.delete('/gitlab/:id', async (c) => {
  return c.json(await deleteGitLabAccount(c.req.param('id')));
});

/** 测试 GitLab 连接。 */
settingsRoutes.post('/gitlab/:id/test', async (c) => {
  const ok = await testGitLabAccount(c.req.param('id'));
  if (ok === null) return c.json({ error: '账号不存在' }, 404);
  return c.json({ ok });
});

/** 列出该账号下的 GitLab 项目（新增仓库时选择）。 */
settingsRoutes.get('/gitlab/:id/projects', async (c) => {
  const projects = await listGitLabProjects(c.req.param('id'), c.req.query('search'));
  if (!projects) return c.json({ error: '账号不存在' }, 404);
  return c.json({ projects });
});

/** 全局 AI 模型列表。 */
settingsRoutes.get('/models', async (c) => {
  return c.json({ models: await listAIModels() });
});

/** 新增全局 AI 模型。 */
settingsRoutes.post('/models', async (c) => {
  const body = await c.req.json();
  return c.json({ model: await createAIModel(body) });
});

settingsRoutes.patch('/models/:id', async (c) => {
  const body = await c.req.json();
  return c.json({ model: await updateAIModel(c.req.param('id'), body) });
});

settingsRoutes.delete('/models/:id', async (c) => {
  return c.json(await deleteAIModel(c.req.param('id')));
});

/** 全局通知配置。 */
settingsRoutes.get('/notification', async (c) => {
  return c.json({ notification: await loadNotificationSetting() });
});

settingsRoutes.patch('/notification', async (c) => {
  const body = await c.req.json();
  return c.json({ notification: await updateNotificationSetting(body) });
});

/** 系统配置与审查数据概览。 */
settingsRoutes.get('/stats', async (c) => {
  return c.json({ stats: await loadSettingsStats() });
});

settingsRoutes.get('/capabilities', async (c) => {
  return c.json(await listCapabilities());
});

settingsRoutes.patch('/capabilities', async (c) => {
  const body = await c.req.json();
  const catalog = await updateCapabilities(body);
  return c.json({ tools: catalog.tools, skills: catalog.skills });
});
