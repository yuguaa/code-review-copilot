import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import type { AIModel } from '@prisma/client';
import type { SessionWithRepository } from '../sessions/session-message-store.service';
import { prisma } from '../../infrastructure/prisma/prisma.service';

/** 解析模型所需的最小配置。 */
export type ModelConfig = {
  provider: string;
  modelId: string;
  apiKey: string;
  apiBaseUrl?: string | null;
  maxSteps: number;
};

type RepositoryForModel = NonNullable<SessionWithRepository['repository']>;
type GlobalDefaultModel = RepositoryForModel['defaultAIModel'];
type StoredAIModel = Pick<AIModel, 'provider' | 'modelId' | 'apiKey' | 'apiBaseUrl' | 'maxSteps' | 'isActive'>;

export type ReviewModelConfigs = {
  primary: ModelConfig;
  delegates: ModelConfig[];
  verifiers: ModelConfig[];
};

export function loadGlobalDefaultModel(): Promise<GlobalDefaultModel> {
  return prisma.aIModel.findFirst({
    where: { isDefault: true, isActive: true },
    orderBy: { updatedAt: 'desc' },
  });
}

export function loadActiveModelConfigs(): Promise<ModelConfig[]> {
  return prisma.aIModel
    .findMany({
      where: { isActive: true },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    })
    .then((models) => models.map(modelConfigOf));
}

function modelConfigOf(model: StoredAIModel): ModelConfig {
  return {
    provider: model.provider,
    modelId: model.modelId,
    apiKey: model.apiKey,
    apiBaseUrl: model.apiBaseUrl,
    maxSteps: model.maxSteps,
  };
}

/** 仅用全局默认模型解析配置（未绑定仓库的会话用）。 */
export function resolveGlobalModelConfig(globalDefaultModel: GlobalDefaultModel): ModelConfig {
  if (!globalDefaultModel) throw new Error('未配置全局默认模型，无法解析模型');
  if (!globalDefaultModel.isActive) throw new Error(`全局默认模型已停用：${globalDefaultModel.provider}/${globalDefaultModel.modelId}`);
  return {
    provider: globalDefaultModel.provider,
    modelId: globalDefaultModel.modelId,
    apiKey: globalDefaultModel.apiKey,
    apiBaseUrl: globalDefaultModel.apiBaseUrl,
    maxSteps: globalDefaultModel.maxSteps,
  };
}

export function resolveRepositoryModelConfig(
  repo: SessionWithRepository['repository'],
  globalDefaultModel: GlobalDefaultModel,
): ModelConfig {
  if (!repo) {
    throw new Error('该会话未绑定仓库模型配置，无法解析模型');
  }

  if (repo.customProvider || repo.customModelId || repo.customApiKey) {
    if (!repo.customProvider || !repo.customModelId || !repo.customApiKey) {
      throw new Error('仓库自定义模型配置不完整');
    }
    return {
      provider: repo.customProvider,
      modelId: repo.customModelId,
      apiKey: repo.customApiKey,
      apiBaseUrl: repo.customApiBaseUrl,
      maxSteps: repo.customMaxSteps ?? repo.defaultAIModel?.maxSteps ?? globalDefaultModel?.maxSteps ?? 16,
    };
  }

  const model = repo.defaultAIModel?.isActive ? repo.defaultAIModel : globalDefaultModel;
  if (!model) throw new Error('未配置全局默认模型，无法解析模型');
  if (!model.isActive) throw new Error(`全局默认模型已停用：${model.provider}/${model.modelId}`);

  return {
    provider: model.provider,
    modelId: model.modelId,
    apiKey: model.apiKey,
    apiBaseUrl: model.apiBaseUrl,
    maxSteps: model.maxSteps,
  };
}

export function resolveReviewModelConfigs(
  repo: SessionWithRepository['repository'],
  globalDefaultModel: GlobalDefaultModel,
  activeModelConfigs: ModelConfig[],
): ReviewModelConfigs {
  const primary = resolveRepositoryModelConfig(repo, globalDefaultModel);
  const distinctModels = uniqueModelConfigs([primary, ...activeModelConfigs]);
  const alternativeVerifiers = distinctModels.filter((config) => !sameModelEndpoint(config, primary));
  const verifiers = alternativeVerifiers.length >= 2
    ? alternativeVerifiers
    : alternativeVerifiers.length === 1
      ? [...alternativeVerifiers, primary]
      : [];
  return {
    primary,
    delegates: activeModelConfigs,
    verifiers,
  };
}

function uniqueModelConfigs(configs: ModelConfig[]): ModelConfig[] {
  return configs.filter((config, index) =>
    configs.findIndex((candidate) => sameModelEndpoint(candidate, config)) === index,
  );
}

export function modelEndpointKey(config: Pick<ModelConfig, 'provider' | 'modelId' | 'apiBaseUrl'>): string {
  const apiBaseUrl = (config.apiBaseUrl ?? '').replace(/\/+$/, '');
  return `${config.provider}\u0000${config.modelId}\u0000${apiBaseUrl}`;
}

function sameModelEndpoint(a: ModelConfig, b: ModelConfig): boolean {
  return modelEndpointKey(a) === modelEndpointKey(b);
}

/**
 * 按模型配置解析 AI SDK LanguageModel。
 * 快速失败：provider 不支持或 key 缺失直接抛错，不降级。
 */
export function resolveModel(config: ModelConfig | null | undefined): LanguageModel {
  if (!config) {
    throw new Error('该会话未绑定仓库模型配置，无法解析模型');
  }
  const { provider, modelId, apiKey, apiBaseUrl } = config;
  if (!apiKey) {
    throw new Error(`模型缺少 apiKey（provider=${provider}）`);
  }

  switch (provider) {
    case 'openai': {
      const openai = createOpenAI({ apiKey, ...(apiBaseUrl ? { baseURL: apiBaseUrl } : {}) });
      return openai(modelId);
    }
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey, ...(apiBaseUrl ? { baseURL: apiBaseUrl } : {}) });
      return anthropic(modelId);
    }
    case 'openai-compatible': {
      if (!apiBaseUrl) {
        throw new Error('openai-compatible 必须配置 apiBaseUrl');
      }
      const compatible = createOpenAICompatible({ name: 'custom', apiKey, baseURL: apiBaseUrl });
      return compatible(modelId);
    }
    default:
      throw new Error(`不支持的模型 provider: ${provider}（支持 openai / anthropic / openai-compatible）`);
  }
}
