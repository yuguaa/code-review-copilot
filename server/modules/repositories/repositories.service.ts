import { Prisma } from "@prisma/client";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { appConfig } from "@server/config/app.config";
import { prisma } from "@server/infrastructure/prisma/prisma.service";
import { validateDingtalkTarget } from "@server/modules/notifications/notifications.service";
import { createGitLabService } from "@server/shared/gitlab/gitlab.service";
import { createLogger } from "@server/shared/logger/logger.service";
import { maskModel } from "../settings/ai-model-settings.service";
import { httpUrl, modelProvider, nonNegativeInteger, optionalCredentialInput, positiveInteger } from "../settings/config-input";

const log = createLogger("repositories");

export const repositoryInput = z.object({
  gitLabAccountId: z.string().trim().min(1),
  gitLabProjectId: z.union([positiveInteger, z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(positiveInteger)]),
  name: z.string().trim().min(1),
  path: z.string().trim().min(1),
  description: z.string().nullable().optional(),
  watchBranches: z.string().nullable().optional(),
  autoReview: z.boolean().default(true),
  defaultAIModelId: z.string().trim().transform((value) => value || null).nullable().optional(),
  customProvider: modelProvider.nullable().optional(),
  customModelId: z.string().trim().min(1).nullable().optional(),
  customApiKey: optionalCredentialInput,
  customApiBaseUrl: httpUrl.nullable().optional(),
  customMaxSteps: positiveInteger.nullable().optional(),
  defaultReviewPrompt: z.string().nullable().optional(),
  enableMrComment: z.boolean().default(false),
  enableDingtalk: z.boolean().default(false),
  dingtalkRobotId: z.string().trim().min(1).nullable().optional(),
  isActive: z.boolean().default(true),
  ocrConcurrency: positiveInteger.max(16).default(2),
  ocrTimeoutMinutes: positiveInteger.max(120).default(10),
  ocrMaxTokensBudget: nonNegativeInteger.default(0),
}).strict();

const repositorySelect = {
  id: true, gitLabAccountId: true, gitLabProjectId: true, name: true, path: true,
  description: true, watchBranches: true, autoReview: true, defaultAIModelId: true,
  customProvider: true, customModelId: true, customApiKey: true, customApiBaseUrl: true,
  customMaxSteps: true, defaultReviewPrompt: true, enableMrComment: true,
  enableDingtalk: true, dingtalkRobotId: true, isActive: true,
  ocrConcurrency: true, ocrTimeoutMinutes: true, ocrMaxTokensBudget: true,
  createdAt: true, updatedAt: true,
  gitLabAccount: { select: { id: true, url: true, isActive: true } },
  defaultAIModel: true,
} satisfies Prisma.RepositorySelect;

type RepositoryRecord = Prisma.RepositoryGetPayload<{ select: typeof repositorySelect }>;

function shouldAutoConfigureWebhooks(): boolean {
  if (process.env.GITLAB_AUTO_CONFIGURE_WEBHOOKS === "0") return false;
  if (process.env.GITLAB_AUTO_CONFIGURE_WEBHOOKS === "1") return true;
  return appConfig.isProduction;
}

function repositoryWebhookUrl(): string {
  const publicUrl = process.env.APP_PUBLIC_URL?.trim();
  if (!publicUrl) throw new HTTPException(500, { message: "APP_PUBLIC_URL 未配置，无法创建 GitLab Webhook" });
  try {
    const url = new URL(publicUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("invalid public URL");
    return `${url.origin}/api/webhook/gitlab`;
  } catch {
    throw new HTTPException(500, { message: "APP_PUBLIC_URL 配置无效，无法创建 GitLab Webhook" });
  }
}

type RepositoryGitLabAccount = {
  url: string;
  accessToken: string;
  webhookSecret: string | null;
  isActive: boolean;
};

function synchronizeRepositoryWebhook(
  account: RepositoryGitLabAccount,
  projectId: number,
  repositoryIsActive: boolean,
): Promise<void> {
  if (!shouldAutoConfigureWebhooks() || !repositoryIsActive || !account.isActive) return Promise.resolve();
  const secret = account.webhookSecret?.trim();
  if (!secret) throw new HTTPException(400, { message: "启用 GitLab 账号必须配置 Webhook Secret" });
  const webhookUrl = repositoryWebhookUrl();
  return createGitLabService(account.url, account.accessToken).ensureProjectWebhook(projectId, webhookUrl, secret)
    .then(() => undefined)
    .catch((error: unknown) => {
      if (error instanceof HTTPException) throw error;
      log.error("GitLab Webhook 自动配置失败", { projectId, error: error instanceof Error ? error.message : String(error) });
      throw new HTTPException(502, { message: "GitLab Webhook 配置失败，请确认 Access Token 具备管理项目 Hook 的权限" });
    });
}

function maskRepository(repository: RepositoryRecord) {
  const { customApiKey, defaultAIModel, ...rest } = repository;
  return {
    ...rest,
    defaultAIModel: defaultAIModel ? maskModel(defaultAIModel) : null,
    hasCustomApiKey: Boolean(customApiKey),
  };
}

function validateCustomModel(repository: {
  customProvider?: string | null; customModelId?: string | null; customApiKey?: string | null;
  customApiBaseUrl?: string | null; customMaxSteps?: number | null;
}) {
  const { customProvider, customModelId, customApiKey, customApiBaseUrl, customMaxSteps } = repository;
  if (!customProvider && !customModelId && !customApiKey && !customApiBaseUrl && customMaxSteps == null) return;
  if (!customProvider || !customModelId || !customApiKey) {
    throw new HTTPException(400, { message: "仓库自定义模型需要 provider、modelId 和 apiKey" });
  }
  if (customProvider === "openai-compatible" && !customApiBaseUrl) {
    throw new HTTPException(400, { message: "openai-compatible 必须配置 apiBaseUrl" });
  }
}

export function listRepositories() {
  return prisma.repository.findMany({ orderBy: { createdAt: "desc" }, select: repositorySelect })
    .then((repositories) => repositories.map(maskRepository));
}

export function createRepository(body: unknown) {
  const data = repositoryInput.parse(body);
  validateCustomModel(data);
  return prisma.gitLabAccount.findUnique({ where: { id: data.gitLabAccountId } }).then((account) => {
    if (!account) throw new HTTPException(404, { message: "GitLab 账号不存在" });
    return synchronizeRepositoryWebhook(account, data.gitLabProjectId, data.isActive).then(() =>
      prisma.$transaction((tx) => validateDingtalkTarget(tx, data.dingtalkRobotId, data.enableDingtalk)
        .then(() => tx.repository.create({ data, select: repositorySelect })))
    );
  }).then(maskRepository);
}

export function updateRepository(id: string, body: unknown) {
  const input = repositoryInput.partial().parse(body);
  const shouldSyncWebhook = input.gitLabAccountId !== undefined || input.gitLabProjectId !== undefined
    || input.isActive === true || input.autoReview === true;
  return prisma.repository.findUnique({ where: { id }, include: { gitLabAccount: true } }).then((current) => {
    if (!current) throw new HTTPException(404, { message: "仓库配置不存在" });
    const data = { ...input };
    if (data.customApiKey === undefined) delete data.customApiKey;
    validateCustomModel({ ...current, ...data });
    const account = data.gitLabAccountId === undefined
      ? Promise.resolve(current.gitLabAccount)
      : prisma.gitLabAccount.findUnique({ where: { id: data.gitLabAccountId } }).then((next) => {
        if (!next) throw new HTTPException(404, { message: "GitLab 账号不存在" });
        return next;
      });
    const synchronization = shouldSyncWebhook
      ? account.then((next) => synchronizeRepositoryWebhook(next, data.gitLabProjectId ?? current.gitLabProjectId,
        data.isActive ?? current.isActive))
      : Promise.resolve();
    return synchronization.then(() => prisma.$transaction(
      (tx) => tx.repository.findUniqueOrThrow({ where: { id } }).then((latest) =>
        validateDingtalkTarget(tx, data.dingtalkRobotId === undefined ? latest.dingtalkRobotId : data.dingtalkRobotId,
          data.enableDingtalk ?? latest.enableDingtalk).then(() => tx.repository.update({ where: { id }, data, select: repositorySelect }))),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ));
  }).then(maskRepository);
}

export function deleteRepository(id: string) {
  return prisma.repository.delete({ where: { id } }).then(() => ({ success: true }));
}

export function listRepositoryBranches(id: string) {
  return prisma.repository.findUnique({ where: { id }, include: { gitLabAccount: true } }).then((repository) => {
    if (!repository) return null;
    return createGitLabService(repository.gitLabAccount.url, repository.gitLabAccount.accessToken)
      .getBranches(repository.gitLabProjectId)
      .then((branches) => branches.map((branch) => branch.name));
  });
}
