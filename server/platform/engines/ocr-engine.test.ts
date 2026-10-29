import { afterEach, describe, expect, it } from "vitest";

import { applyThinkingCompatibility, shouldDisableThinking } from "./ocr-engine";

describe("OCR 模型兼容配置", () => {
  afterEach(() => delete process.env.OCR_DISABLE_THINKING);

  it("默认只为 DeepSeek OpenAI-compatible 模型关闭 thinking", () => {
    expect(shouldDisableThinking({ provider: "openai-compatible", modelId: "deepseek-v4-pro" })).toBe(true);
    expect(shouldDisableThinking({ provider: "openai-compatible", modelId: "qwen3.8-flash" })).toBe(false);
    expect(shouldDisableThinking({ provider: "anthropic", modelId: "deepseek-v4-pro" })).toBe(false);
  });

  it("保留用户已有 thinking 配置，不覆盖兼容字段", () => {
    const config = { llm: { extra_body: { thinking: { type: "enabled" }, temperature: 0.2 } } };
    expect(applyThinkingCompatibility(config, { provider: "openai-compatible", modelId: "deepseek-v4-pro" })).toEqual({ config, changed: false });
  });

  it("仅在缺少 thinking 配置时注入禁用值", () => {
    const result = applyThinkingCompatibility({ llm: { extra_body: { temperature: 0.2 } } }, {
      provider: "openai-compatible", modelId: "deepseek-v4-pro",
    });
    expect(result.changed).toBe(true);
    expect(result.config).toEqual({ llm: { extra_body: { temperature: 0.2, thinking: { type: "disabled" } } } });
  });
});
