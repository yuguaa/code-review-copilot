import { getCapabilityCatalog, syncBuiltinCapabilities } from '../../agent/capabilities';
import { createGitLabService } from '../../lib/gitlab';
import { prisma } from '../../lib/prisma';

type GitLabAccountPayload = {
  url?: string;
  accessToken?: string;
  webhookSecret?: string | null;
  isActive?: boolean;
};

type AIModelPayload = {
  provider?: string;
  modelId?: string;
  apiKey?: string;
  apiBaseUrl?: string | null;
  maxSteps?: number;
  isDefault?: boolean;
  isActive?: boolean;
};

type NotificationPayload = {
  dingtalkEnabled?: boolean;
  dingtalkWebhookUrl?: string | null;
  dingtalkSecret?: string;
};

type CapabilityPayload = {
  tools?: Array<{ key?: string; defaultEnabled?: boolean; isActive?: boolean }>;
  skills?: Array<{ key?: string; defaultEnabled?: boolean; isActive?: boolean }>;
};

function maskAccount(account: { accessToken?: string; webhookSecret?: string | null; [key: string]: unknown }) {
  const { accessToken, webhookSecret, ...rest } = account;
  return { ...rest, hasAccessToken: Boolean(accessToken), hasWebhookSecret: Boolean(webhookSecret) };
}

function maskModel(model: { apiKey?: string; [key: string]: unknown }) {
  const { apiKey, ...rest } = model;
  return { ...rest, hasApiKey: Boolean(apiKey) };
}

function maskNotification(setting: { dingtalkSecret?: string | null; dingtalkEnabled?: boolean; dingtalkWebhookUrl?: string | null } | null) {
  return {
    dingtalkEnabled: setting?.dingtalkEnabled ?? false,
    dingtalkWebhookUrl: setting?.dingtalkWebhookUrl ?? null,
    hasDingtalkSecret: Boolean(setting?.dingtalkSecret),
  };
}

function modelUpdateData(body: AIModelPayload) {
  const data: Record<string, unknown> = {};
  for (const key of ['provider', 'modelId', 'apiBaseUrl', 'maxSteps', 'isDefault', 'isActive'] as const) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  if (typeof body.apiKey === 'string' && body.apiKey.length > 0) data.apiKey = body.apiKey;
  return data;
}

export async function listGitLabAccounts() {
  const accounts = await prisma.gitLabAccount.findMany({ orderBy: { createdAt: 'desc' } });
  return accounts.map(maskAccount);
}

export async function createGitLabAccount(body: GitLabAccountPayload) {
  const account = await prisma.gitLabAccount.create({
    data: { url: body.url ?? '', accessToken: body.accessToken ?? '', webhookSecret: body.webhookSecret ?? null },
  });
  return maskAccount(account);
}

export async function updateGitLabAccount(id: string, body: GitLabAccountPayload) {
  const data: Record<string, unknown> = {};
  if (body.url !== undefined) data.url = body.url;
  if (body.webhookSecret !== undefined) data.webhookSecret = body.webhookSecret;
  if (body.isActive !== undefined) data.isActive = body.isActive;
  if (typeof body.accessToken === 'string' && body.accessToken.length > 0) data.accessToken = body.accessToken;
  const account = await prisma.gitLabAccount.update({ where: { id }, data });
  return maskAccount(account);
}

export async function deleteGitLabAccount(id: string) {
  await prisma.gitLabAccount.delete({ where: { id } }).catch(() => undefined);
  return { success: true };
}

export async function testGitLabAccount(id: string) {
  const account = await prisma.gitLabAccount.findUnique({ where: { id } });
  if (!account) return null;
  const gitlab = createGitLabService(account.url, account.accessToken);
  return gitlab.testConnection().catch(() => false);
}

export async function listGitLabProjects(id: string, search?: string) {
  const account = await prisma.gitLabAccount.findUnique({ where: { id } });
  if (!account) return null;
  const gitlab = createGitLabService(account.url, account.accessToken);
  const projects = await gitlab.getProjects(search, { membership: true, per_page: 50 });
  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    path: project.path_with_namespace,
    defaultBranch: project.default_branch,
  }));
}

export async function listAIModels() {
  const models = await prisma.aIModel.findMany({ orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }] });
  return models.map(maskModel);
}

export async function createAIModel(body: AIModelPayload) {
  const model = await prisma.$transaction(async (tx) => {
    if (body.isDefault === true) {
      await tx.aIModel.updateMany({ data: { isDefault: false } });
    }
    return tx.aIModel.create({
      data: {
        provider: body.provider ?? '',
        modelId: body.modelId ?? '',
        apiKey: body.apiKey ?? '',
        apiBaseUrl: body.apiBaseUrl || null,
        maxSteps: body.maxSteps ?? 16,
        isDefault: body.isDefault ?? false,
        isActive: body.isActive ?? true,
      },
    });
  });
  return maskModel(model);
}

export async function updateAIModel(id: string, body: AIModelPayload) {
  const model = await prisma.$transaction(async (tx) => {
    if (body.isDefault === true) {
      await tx.aIModel.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
    }
    return tx.aIModel.update({ where: { id }, data: modelUpdateData(body) });
  });
  return maskModel(model);
}

export async function deleteAIModel(id: string) {
  await prisma.aIModel.delete({ where: { id } }).catch(() => undefined);
  return { success: true };
}

export async function loadNotificationSetting() {
  const setting = await prisma.notificationSetting.findUnique({ where: { scope: 'global' } });
  return maskNotification(setting);
}

export async function updateNotificationSetting(body: NotificationPayload) {
  const data: Record<string, unknown> = {};
  if (body.dingtalkEnabled !== undefined) data.dingtalkEnabled = body.dingtalkEnabled;
  if (body.dingtalkWebhookUrl !== undefined) data.dingtalkWebhookUrl = body.dingtalkWebhookUrl || null;
  if (typeof body.dingtalkSecret === 'string' && body.dingtalkSecret.length > 0) data.dingtalkSecret = body.dingtalkSecret;
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
  return maskNotification(setting);
}

export async function loadSettingsStats() {
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
  return {
    repositoryCount,
    activeRepositoryCount,
    modelCount,
    gitLabAccountCount,
    sessionCount,
    reviewSessionCount,
    chatSessionCount,
    messageCount,
    latestSessionAt: latestSession?.updatedAt ?? null,
  };
}

export async function listCapabilities() {
  const catalog = await getCapabilityCatalog();
  return {
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
  };
}

export async function updateCapabilities(body: CapabilityPayload) {
  await syncBuiltinCapabilities();
  await prisma.$transaction(async (tx) => {
    for (const item of Array.isArray(body.tools) ? body.tools : []) {
      if (!item.key) continue;
      await tx.agentTool.update({
        where: { key: item.key },
        data: {
          ...(item.defaultEnabled !== undefined ? { defaultEnabled: item.defaultEnabled } : {}),
          ...(item.isActive !== undefined ? { isActive: item.isActive } : {}),
        },
      });
    }
    for (const item of Array.isArray(body.skills) ? body.skills : []) {
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
  return getCapabilityCatalog();
}
