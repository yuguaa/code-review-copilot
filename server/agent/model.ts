import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import type { SessionWithRepository } from '../lib/chat-store';

/** 解析模型所需的最小配置。 */
export type ModelConfig = {
  provider: string; // openai | anthropic | openai-compatible
  modelId: string;
  apiKey: string;
  apiBaseUrl?: string | null;
  maxSteps: number;
};

export function resolveRepositoryModelConfig(repo: SessionWithRepository['repository']): ModelConfig {
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
      maxSteps: repo.customMaxSteps ?? repo.defaultAIModel?.maxSteps ?? 16,
    };
  }

  if (!repo.defaultAIModel) {
    throw new Error('仓库未绑定全局模型配置');
  }

  return {
    provider: repo.defaultAIModel.provider,
    modelId: repo.defaultAIModel.modelId,
    apiKey: repo.defaultAIModel.apiKey,
    apiBaseUrl: repo.defaultAIModel.apiBaseUrl,
    maxSteps: repo.defaultAIModel.maxSteps,
  };
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
