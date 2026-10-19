import { ModelRuntime } from "@earendil-works/pi-coding-agent";

import type { ModelConfig } from "@server/modules/ai-models/ai-models.service";

export const SECURITY_MODEL_PROVIDER_ID = "security-runtime";
export const SECURITY_MODEL_CONTEXT_WINDOW = 128_000;
export const SECURITY_MODEL_MAX_OUTPUT_TOKENS = 8_192;

export type SecurityPiModel = NonNullable<ReturnType<ModelRuntime["getModel"]>>;

type SecurityProviderApi = "anthropic-messages" | "openai-responses" | "openai-completions";

function providerSettings(provider: string, apiBaseUrl: string | null): {
  api: SecurityProviderApi;
  baseUrl: string;
} {
  switch (provider) {
    case "anthropic":
      return {
        api: "anthropic-messages",
        baseUrl: apiBaseUrl?.trim() || "https://api.anthropic.com",
      };
    case "openai":
      return {
        api: "openai-responses",
        baseUrl: apiBaseUrl?.trim() || "https://api.openai.com/v1",
      };
    case "openai-compatible": {
      const baseUrl = apiBaseUrl?.trim();
      if (!baseUrl) throw new Error("openai-compatible 必须配置 apiBaseUrl");
      return { api: "openai-completions", baseUrl };
    }
    default:
      throw new Error(`不支持的模型 provider：${provider}`);
  }
}

/**
 * 在独立内存运行时中注册安全测试模型。
 * API Key 只进入本次 Provider 注册，不写入日志或持久化配置。
 */
export function createSecurityModel(
  config: ModelConfig,
): Promise<{ modelRuntime: ModelRuntime; model: SecurityPiModel }> {
  const modelId = config.modelId.trim();
  const apiKey = config.apiKey.trim();
  if (!modelId) throw new Error("模型缺少 modelId");
  if (!apiKey) throw new Error("模型缺少 apiKey");

  const { api, baseUrl } = providerSettings(config.provider, config.apiBaseUrl);

  return ModelRuntime.create({
    modelsPath: null,
    refreshOnCreate: false,
  }).then((modelRuntime) => {
    modelRuntime.registerProvider(SECURITY_MODEL_PROVIDER_ID, {
      name: "Security Runtime",
      baseUrl,
      apiKey,
      api,
      models: [{
        id: modelId,
        name: modelId,
        api,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: SECURITY_MODEL_CONTEXT_WINDOW,
        maxTokens: SECURITY_MODEL_MAX_OUTPUT_TOKENS,
      }],
    });

    const model = modelRuntime.getModel(SECURITY_MODEL_PROVIDER_ID, modelId);
    if (!model) throw new Error(`模型注册失败：${SECURITY_MODEL_PROVIDER_ID}/${modelId}`);
    return { modelRuntime, model };
  });
}
