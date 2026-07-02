import { Hono } from 'hono';
import { prisma } from '../lib/prisma';
import { createGitLabService } from '../lib/gitlab';
import { getCapabilityCatalog } from '../agent/capabilities';

export const repositoryRoutes = new Hono();

/** 不回传敏感字段 apiKey（列表查询里 gitLabAccount 仅含 id/url，不含 token）。 */
function maskRepo<T extends { customApiKey?: string | null; defaultAIModel?: { apiKey?: string } | null; toolSettings?: unknown; skillSettings?: unknown }>(r: T) {
  const { customApiKey, defaultAIModel, toolSettings, skillSettings, ...rest } = r;
  const maskedModel = defaultAIModel
    ? (() => {
        const { apiKey, ...modelRest } = defaultAIModel;
        return { ...modelRest, hasApiKey: Boolean(apiKey) };
      })()
    : null;
  return { ...rest, defaultAIModel: maskedModel, hasCustomApiKey: Boolean(customApiKey) };
}

repositoryRoutes.get('/', async (c) => {
  const repos = await prisma.repository.findMany({
    orderBy: { updatedAt: 'desc' },
    include: {
      gitLabAccount: { select: { id: true, url: true } },
      defaultAIModel: true,
      toolSettings: { include: { tool: { select: { key: true, defaultEnabled: true } } } },
      skillSettings: { include: { skill: { select: { key: true, defaultEnabled: true } } } },
    },
  });
  const catalog = await getCapabilityCatalog();
  const repositories = repos.map((repo) => {
    const masked = maskRepo(repo);
    const toolOverrides = new Map(repo.toolSettings.map((item) => [item.tool.key, item.enabled]));
    const skillOverrides = new Map(repo.skillSettings.map((item) => [item.skill.key, item.enabled]));
    return {
      ...masked,
      enabledTools: catalog.tools.filter((tool) => toolOverrides.get(tool.key) ?? tool.defaultEnabled).map((tool) => tool.key),
      enabledSkills: catalog.skills.filter((skill) => skillOverrides.get(skill.key) ?? skill.defaultEnabled).map((skill) => skill.key),
    };
  });
  return c.json({ repositories });
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
      defaultAIModelId: b.defaultAIModelId || null,
      customProvider: b.customProvider || null,
      customModelId: b.customModelId || null,
      customApiKey: b.customApiKey || null,
      customApiBaseUrl: b.customApiBaseUrl || null,
      customMaxSteps: b.customMaxSteps ?? null,
      defaultReviewPrompt: b.defaultReviewPrompt ?? null,
      enableMrComment: b.enableMrComment ?? false,
      enableDingtalk: b.enableDingtalk ?? true,
      dingtalkWebhook: b.dingtalkWebhook || null,
      dingtalkSecret: b.dingtalkSecret || null,
    },
  });
  await saveCapabilityOverrides(repo.id, b.enabledTools, b.enabledSkills);
  return c.json({ repository: maskRepo(repo) });
});

repositoryRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const b = await c.req.json();
  // 只更新传入的字段；apiKey 为空串时不覆盖
  const data: Record<string, unknown> = {};
  for (const k of [
    'gitLabAccountId', 'name', 'path', 'description', 'watchBranches', 'autoReview',
    'defaultAIModelId', 'customProvider', 'customModelId', 'customApiBaseUrl', 'customMaxSteps',
    'defaultReviewPrompt', 'isActive',
    'enableMrComment', 'enableDingtalk', 'dingtalkWebhook',
  ]) {
    if (b[k] !== undefined) data[k] = b[k];
  }
  if (b.gitLabProjectId !== undefined) data.gitLabProjectId = Number(b.gitLabProjectId);
  if (b.customApiKey === null) data.customApiKey = null;
  if (typeof b.customApiKey === 'string' && b.customApiKey.length > 0) data.customApiKey = b.customApiKey;
  if (b.dingtalkSecret === null) data.dingtalkSecret = null;
  if (typeof b.dingtalkSecret === 'string' && b.dingtalkSecret.length > 0) data.dingtalkSecret = b.dingtalkSecret;
  const repo = await prisma.repository.update({ where: { id }, data });
  await saveCapabilityOverrides(id, b.enabledTools, b.enabledSkills);
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

repositoryRoutes.get('/:id/capabilities', async (c) => {
  const repositoryId = c.req.param('id');
  const repo = await prisma.repository.findUnique({
    where: { id: repositoryId },
    include: {
      toolSettings: { include: { tool: true } },
      skillSettings: { include: { skill: true } },
    },
  });
  if (!repo) return c.json({ error: '仓库不存在' }, 404);
  const catalog = await getCapabilityCatalog();
  const toolOverrides = new Map(repo.toolSettings.map((item) => [item.tool.key, item.enabled]));
  const skillOverrides = new Map(repo.skillSettings.map((item) => [item.skill.key, item.enabled]));
  return c.json({
    tools: catalog.tools.map((tool) => ({
      id: tool.id,
      key: tool.key,
      name: tool.name,
      description: tool.description,
      category: tool.category,
      defaultEnabled: tool.defaultEnabled,
      enabled: toolOverrides.get(tool.key) ?? tool.defaultEnabled,
    })),
    skills: catalog.skills.map((skill) => ({
      id: skill.id,
      key: skill.key,
      name: skill.name,
      description: skill.description,
      mode: skill.mode,
      defaultEnabled: skill.defaultEnabled,
      enabled: skillOverrides.get(skill.key) ?? skill.defaultEnabled,
    })),
  });
});

async function saveCapabilityOverrides(repositoryId: string, enabledTools: unknown, enabledSkills: unknown) {
  if (!Array.isArray(enabledTools) && !Array.isArray(enabledSkills)) return;
  const catalog = await getCapabilityCatalog();
  if (Array.isArray(enabledTools)) {
    const allowedKeys = new Set(catalog.tools.map((tool) => tool.key));
    for (const key of enabledTools) {
      if (typeof key === 'string' && !allowedKeys.has(key)) throw new Error(`未知 Tool：${key}`);
    }
  }
  if (Array.isArray(enabledSkills)) {
    const allowedKeys = new Set(catalog.skills.map((skill) => skill.key));
    for (const key of enabledSkills) {
      if (typeof key === 'string' && !allowedKeys.has(key)) throw new Error(`未知 Skill：${key}`);
    }
  }
  await prisma.$transaction(async (tx) => {
    if (Array.isArray(enabledTools)) {
      await tx.repositoryToolSetting.deleteMany({ where: { repositoryId } });
      const enabled = new Set(enabledTools.filter((key): key is string => typeof key === 'string'));
      await tx.repositoryToolSetting.createMany({
        data: catalog.tools
          .filter((tool) => enabled.has(tool.key) !== tool.defaultEnabled)
          .map((tool) => ({ repositoryId, toolId: tool.id, enabled: enabled.has(tool.key) })),
      });
    }
    if (Array.isArray(enabledSkills)) {
      await tx.repositorySkillSetting.deleteMany({ where: { repositoryId } });
      const enabled = new Set(enabledSkills.filter((key): key is string => typeof key === 'string'));
      await tx.repositorySkillSetting.createMany({
        data: catalog.skills
          .filter((skill) => enabled.has(skill.key) !== skill.defaultEnabled)
          .map((skill) => ({ repositoryId, skillId: skill.id, enabled: enabled.has(skill.key) })),
      });
    }
  });
}
