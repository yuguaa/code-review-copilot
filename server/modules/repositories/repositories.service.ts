import { Prisma } from "@prisma/client";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { prisma } from "@server/infrastructure/prisma/prisma.service";
import { validateDingtalkTarget } from "@server/modules/notifications/notifications.service";
import { createGitLabService } from "@server/shared/gitlab/gitlab.service";
import { maskModel } from "../settings/ai-model-settings.service";
import { httpUrl, modelProvider, optionalCredentialInput, positiveInteger } from "../settings/config-input";

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
  ocrMaxTokensBudget: positiveInteger.default(200000),
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
  return prisma.$transaction((tx) => validateDingtalkTarget(tx, data.dingtalkRobotId, data.enableDingtalk)
    .then(() => tx.repository.create({ data, select: repositorySelect }))).then(maskRepository);
}

export function updateRepository(id: string, body: unknown) {
  const input = repositoryInput.partial().parse(body);
  return prisma.$transaction((tx) => tx.repository.findUniqueOrThrow({ where: { id } }).then((current) => {
    const data = { ...input };
    if (data.customApiKey === undefined) delete data.customApiKey;
    validateCustomModel({ ...current, ...data });
    return validateDingtalkTarget(tx, data.dingtalkRobotId === undefined ? current.dingtalkRobotId : data.dingtalkRobotId,
      data.enableDingtalk ?? current.enableDingtalk).then(() => tx.repository.update({ where: { id }, data, select: repositorySelect }));
  }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).then(maskRepository);
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
