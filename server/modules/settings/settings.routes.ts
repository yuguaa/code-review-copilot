import { Hono } from 'hono';
import { createAIModel, deleteAIModel, getAIModel, listAIModels, updateAIModel } from './ai-model-settings.service';
import { listToolSkillSettings, updateToolSkillSettings } from './tool-skill-settings.service';
import {
  createGitLabAccount,
  deleteGitLabAccount,
  listGitLabAccounts,
  listGitLabProjects,
  testGitLabAccount,
  updateGitLabAccount,
} from './gitlab-account-settings.service';
import { loadNotificationSetting, updateNotificationSetting } from './notification-settings.service';
import { loadSettingsStats } from './settings-overview.service';

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

settingsRoutes.get('/models/:id', async (c) => {
  const model = await getAIModel(c.req.param('id'));
  if (!model) return c.json({ error: '模型不存在' }, 404);
  return c.json({ model });
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

settingsRoutes.get('/tool-skills', async (c) => {
  return c.json(await listToolSkillSettings());
});

settingsRoutes.patch('/tool-skills', async (c) => {
  const body = await c.req.json();
  return c.json(await updateToolSkillSettings(body));
});
