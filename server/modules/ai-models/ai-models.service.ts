import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { prisma } from "@server/infrastructure/prisma/prisma.service";

import type { AIModel, Repository } from "@prisma/client";
import type { LanguageModel } from "ai";

export type ModelConfig = Pick<AIModel, "provider" | "modelId" | "apiKey" | "apiBaseUrl" | "maxSteps">;
export type RepositoryModelConfig = Pick<Repository,
  "customProvider" | "customModelId" | "customApiKey" | "customApiBaseUrl" | "customMaxSteps"
> & { defaultAIModel: AIModel | null };

function modelConfigOf(model: ModelConfig): ModelConfig {
  return {
    provider: model.provider,
    modelId: model.modelId,
    apiKey: model.apiKey,
    apiBaseUrl: model.apiBaseUrl,
    maxSteps: model.maxSteps,
  };
}

export function loadGlobalDefaultModel(): Promise<AIModel | null> {
  return prisma.aIModel.findFirst({
    where: { isDefault: true, isActive: true },
    orderBy: { updatedAt: "desc" },
  });
}

export function loadActiveModelConfig(id: string): Promise<ModelConfig | null> {
  return prisma.aIModel.findFirst({ where: { id, isActive: true } })
    .then((model) => model ? modelConfigOf(model) : null);
}

export function resolveGlobalModelConfig(model: AIModel | null): ModelConfig {
  if (!model) throw new Error("请配置全局默认模型");
  if (!model.isActive) throw new Error("全局默认模型已经停用");
  return modelConfigOf(model);
}

export function resolveRepositoryModelConfig(
  repo: RepositoryModelConfig | null,
  globalDefaultModel: AIModel | null,
): ModelConfig {
  if (!repo) throw new Error("会话没有关联仓库");
  if (repo.customProvider || repo.customModelId || repo.customApiKey || repo.customApiBaseUrl || repo.customMaxSteps != null) {
    if (!repo.customProvider || !repo.customModelId || !repo.customApiKey) {
      throw new Error("仓库自定义模型配置不完整");
    }
    return {
      provider: repo.customProvider,
      modelId: repo.customModelId,
      apiKey: repo.customApiKey,
      apiBaseUrl: repo.customApiBaseUrl,
      maxSteps: repo.customMaxSteps ?? 16,
    };
  }
  if (repo.defaultAIModel) {
    if (!repo.defaultAIModel.isActive) throw new Error("仓库选择的模型已经停用");
    return modelConfigOf(repo.defaultAIModel);
  }
  return resolveGlobalModelConfig(globalDefaultModel);
}

export function resolveModel(config: ModelConfig | null | undefined): LanguageModel {
  if (!config) throw new Error("缺少模型配置");
  const { provider, modelId, apiKey, apiBaseUrl } = config;
  if (!modelId.trim()) throw new Error("模型缺少 modelId");
  if (!apiKey.trim()) throw new Error("模型缺少 apiKey");
  switch (provider) {
    case "openai": return createOpenAI({ apiKey, baseURL: apiBaseUrl ?? undefined })(modelId);
    case "anthropic": return createAnthropic({ apiKey, baseURL: apiBaseUrl ?? undefined })(modelId);
    case "openai-compatible": {
      if (!apiBaseUrl) throw new Error("openai-compatible 必须配置 apiBaseUrl");
      return createOpenAICompatible({ name: "custom", apiKey, baseURL: apiBaseUrl })(modelId);
    }
    default: throw new Error(`不支持的模型 provider：${provider}`);
  }
}
