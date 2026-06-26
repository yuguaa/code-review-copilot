import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

/** 解析模型所需的最小仓库配置。 */
export type ModelConfig = {
  modelProvider: string; // openai | anthropic | openai-compatible
  modelId: string;
  apiKey: string;
  apiBaseUrl?: string | null;
};

/**
 * 按仓库配置解析 AI SDK LanguageModel。
 * 快速失败：provider 不支持或 key 缺失直接抛错，不降级。
 */
export function resolveModel(config: ModelConfig | null | undefined): LanguageModel {
  if (!config) {
    throw new Error('该会话未绑定仓库模型配置，无法解析模型');
  }
  const { modelProvider, modelId, apiKey, apiBaseUrl } = config;
  if (!apiKey) {
    throw new Error(`仓库模型缺少 apiKey（provider=${modelProvider}）`);
  }

  switch (modelProvider) {
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
      throw new Error(`不支持的模型 provider: ${modelProvider}（支持 openai / anthropic / openai-compatible）`);
  }
}
