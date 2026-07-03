import { getCapabilityCatalog } from '../../agent/capabilities';
import { createGitLabService } from '../../lib/gitlab';
import { prisma } from '../../lib/prisma';

type RepositoryPayload = {
  gitLabAccountId?: string;
  gitLabProjectId?: string | number;
  name?: string;
  path?: string;
  description?: string | null;
  watchBranches?: string | null;
  autoReview?: boolean;
  defaultAIModelId?: string | null;
  customProvider?: string | null;
  customModelId?: string | null;
  customApiKey?: string | null;
  customApiBaseUrl?: string | null;
  customMaxSteps?: number | null;
  defaultReviewPrompt?: string | null;
  enableMrComment?: boolean;
  enableDingtalk?: boolean;
  dingtalkWebhook?: string | null;
  dingtalkSecret?: string | null;
  isActive?: boolean;
  enabledTools?: unknown;
  enabledSkills?: unknown;
};

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`缺少${label}`);
  return value;
}

function maskRepo<
  T extends {
    customApiKey?: string | null;
    defaultAIModel?: { apiKey?: string } | null;
    toolSettings?: unknown;
    skillSettings?: unknown;
  },
>(repository: T) {
  const { customApiKey, defaultAIModel, toolSettings, skillSettings, ...rest } = repository;
  const maskedModel = defaultAIModel
    ? (() => {
        const { apiKey, ...modelRest } = defaultAIModel;
        return { ...modelRest, hasApiKey: Boolean(apiKey) };
      })()
    : null;
  return { ...rest, defaultAIModel: maskedModel, hasCustomApiKey: Boolean(customApiKey) };
}

function createRepositoryData(body: RepositoryPayload) {
  return {
    gitLabAccountId: requireString(body.gitLabAccountId, 'GitLab 账号'),
    gitLabProjectId: Number(body.gitLabProjectId),
    name: requireString(body.name, '仓库名称'),
    path: requireString(body.path, '仓库路径'),
    description: body.description ?? null,
    watchBranches: body.watchBranches ?? null,
    autoReview: body.autoReview ?? true,
    defaultAIModelId: body.defaultAIModelId || null,
    customProvider: body.customProvider || null,
    customModelId: body.customModelId || null,
    customApiKey: body.customApiKey || null,
    customApiBaseUrl: body.customApiBaseUrl || null,
    customMaxSteps: body.customMaxSteps ?? null,
    defaultReviewPrompt: body.defaultReviewPrompt ?? null,
    enableMrComment: body.enableMrComment ?? false,
    enableDingtalk: body.enableDingtalk ?? true,
    dingtalkWebhook: body.dingtalkWebhook || null,
    dingtalkSecret: body.dingtalkSecret || null,
  };
}

function updateRepositoryData(body: RepositoryPayload) {
  const data: Record<string, unknown> = {};
  for (const key of [
    'gitLabAccountId',
    'name',
    'path',
    'description',
    'watchBranches',
    'autoReview',
    'defaultAIModelId',
    'customProvider',
    'customModelId',
    'customApiBaseUrl',
    'customMaxSteps',
    'defaultReviewPrompt',
    'isActive',
    'enableMrComment',
    'enableDingtalk',
    'dingtalkWebhook',
  ] as const) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  if (body.gitLabProjectId !== undefined) data.gitLabProjectId = Number(body.gitLabProjectId);
  if (body.customApiKey === null) data.customApiKey = null;
  if (typeof body.customApiKey === 'string' && body.customApiKey.length > 0) data.customApiKey = body.customApiKey;
  if (body.dingtalkSecret === null) data.dingtalkSecret = null;
  if (typeof body.dingtalkSecret === 'string' && body.dingtalkSecret.length > 0) data.dingtalkSecret = body.dingtalkSecret;
  return data;
}

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

export async function listRepositories() {
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
  return repos.map((repo) => {
    const masked = maskRepo(repo);
    const toolOverrides = new Map(repo.toolSettings.map((item) => [item.tool.key, item.enabled]));
    const skillOverrides = new Map(repo.skillSettings.map((item) => [item.skill.key, item.enabled]));
    return {
      ...masked,
      enabledTools: catalog.tools.filter((tool) => toolOverrides.get(tool.key) ?? tool.defaultEnabled).map((tool) => tool.key),
      enabledSkills: catalog.skills.filter((skill) => skillOverrides.get(skill.key) ?? skill.defaultEnabled).map((skill) => skill.key),
    };
  });
}

export async function createRepository(body: RepositoryPayload) {
  const repo = await prisma.repository.create({ data: createRepositoryData(body) });
  await saveCapabilityOverrides(repo.id, body.enabledTools, body.enabledSkills);
  return maskRepo(repo);
}

export async function updateRepository(id: string, body: RepositoryPayload) {
  const repo = await prisma.repository.update({ where: { id }, data: updateRepositoryData(body) });
  await saveCapabilityOverrides(id, body.enabledTools, body.enabledSkills);
  return maskRepo(repo);
}

export async function deleteRepository(id: string) {
  await prisma.repository.delete({ where: { id } }).catch(() => undefined);
  return { success: true };
}

export async function listRepositoryBranches(id: string) {
  const repo = await prisma.repository.findUnique({
    where: { id },
    include: { gitLabAccount: true },
  });
  if (!repo) return null;
  const gitlab = createGitLabService(repo.gitLabAccount.url, repo.gitLabAccount.accessToken);
  const branches = await gitlab.getBranches(repo.gitLabProjectId, { per_page: 100 });
  return branches.map((branch) => branch.name);
}

export async function listRepositoryCapabilities(repositoryId: string) {
  const repo = await prisma.repository.findUnique({
    where: { id: repositoryId },
    include: {
      toolSettings: { include: { tool: true } },
      skillSettings: { include: { skill: true } },
    },
  });
  if (!repo) return null;
  const catalog = await getCapabilityCatalog();
  const toolOverrides = new Map(repo.toolSettings.map((item) => [item.tool.key, item.enabled]));
  const skillOverrides = new Map(repo.skillSettings.map((item) => [item.skill.key, item.enabled]));
  return {
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
  };
}
