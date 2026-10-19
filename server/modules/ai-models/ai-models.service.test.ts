import { describe, expect, it } from "vitest";

import { resolveGlobalModelConfig, resolveModel, resolveRepositoryModelConfig } from "./ai-models.service";

import type { AIModel } from "@prisma/client";
import type { RepositoryModelConfig } from "./ai-models.service";

const model: AIModel = {
  id: "model-1", provider: "openai", modelId: "gpt-test", apiKey: "test-key",
  apiBaseUrl: null, maxSteps: 16, isDefault: true, isActive: true,
  createdAt: new Date(0), updatedAt: new Date(0),
};
const repository: RepositoryModelConfig = {
  defaultAIModel: null, customProvider: null, customModelId: null,
  customApiKey: null, customApiBaseUrl: null, customMaxSteps: null,
};

describe("模型选择", () => {
  it("没有仓库模型时使用全局默认模型", () => {
    expect(resolveRepositoryModelConfig(repository, model)).toMatchObject({ provider: "openai", modelId: "gpt-test" });
  });
  it("显式选择的停用模型立即失败", () => {
    expect(() => resolveRepositoryModelConfig({ ...repository, defaultAIModel: { ...model, isActive: false } }, model)).toThrow("停用");
  });
  it("不完整的自定义配置立即失败", () => {
    expect(() => resolveRepositoryModelConfig({ ...repository, customProvider: "anthropic" }, model)).toThrow("不完整");
    expect(() => resolveRepositoryModelConfig({ ...repository, customMaxSteps: 8 }, model)).toThrow("不完整");
  });
  it("自定义模型不借用其他模型的参数", () => {
    expect(resolveRepositoryModelConfig({
      ...repository, customProvider: "anthropic", customModelId: "claude-test", customApiKey: "test-key",
    }, { ...model, maxSteps: 40 })).toMatchObject({ modelId: "claude-test", maxSteps: 16 });
  });
  it("缺少默认模型时立即失败", () => {
    expect(() => resolveGlobalModelConfig(null)).toThrow("默认模型");
  });
});

describe("模型 Provider", () => {
  it("使用真实 AI SDK 创建三个 Provider 的模型对象，不发起生成请求", () => {
    for (const provider of ["openai", "anthropic", "openai-compatible"]) {
      expect(resolveModel({ ...model, provider, apiBaseUrl: "https://example.com/v1" })).toMatchObject({ modelId: "gpt-test" });
    }
  });
  it("无效 Provider、凭证和自定义地址立即失败", () => {
    expect(() => resolveModel({ ...model, provider: "unknown" })).toThrow("不支持");
    expect(() => resolveModel({ ...model, apiKey: " " })).toThrow("apiKey");
    expect(() => resolveModel({ ...model, provider: "openai-compatible" })).toThrow("apiBaseUrl");
  });
});
