import { describe, expect, it } from "vitest";

import { maskModel } from "./ai-model-settings.service";
import { aiModelInput, gitLabAccountInput, dingtalkRobotInput } from "./config-input";

describe("配置凭证", () => {
  it("模型响应移除 apiKey", () => {
    const output = maskModel({
      id: "model-1", provider: "openai", modelId: "gpt-test", apiKey: "secret", apiBaseUrl: null,
      maxSteps: 16, isDefault: true, isActive: true, createdAt: new Date(0), updatedAt: new Date(0),
    });
    expect(output).not.toHaveProperty("apiKey");
    expect(output.hasApiKey).toBe(true);
  });
  it("模型和 GitLab 必填凭证不允许 null，空白输入保留原值", () => {
    expect(aiModelInput.partial().parse({ apiKey: " " }).apiKey).toBeUndefined();
    expect(gitLabAccountInput.partial().parse({ accessToken: "" }).accessToken).toBeUndefined();
    expect(aiModelInput.partial().safeParse({ apiKey: null }).success).toBe(false);
    expect(gitLabAccountInput.partial().safeParse({ accessToken: null }).success).toBe(false);
  });
  it("钉钉和 Webhook 可选凭证可以明确清除", () => {
    expect(dingtalkRobotInput.partial().parse({ secret: null }).secret).toBeNull();
    expect(dingtalkRobotInput.partial().parse({ webhookUrl: "" }).webhookUrl).toBeUndefined();
    expect(dingtalkRobotInput.partial().safeParse({ webhookUrl: null }).success).toBe(false);
    expect(gitLabAccountInput.partial().parse({ webhookSecret: null }).webhookSecret).toBeNull();
  });
  it("拒绝带登录凭证的实例地址和无效模型参数", () => {
    expect(gitLabAccountInput.safeParse({ url: "https://user:secret@example.com", accessToken: "token" }).success).toBe(false);
    expect(aiModelInput.safeParse({ provider: "unknown", modelId: "model", apiKey: "key" }).success).toBe(false);
    expect(aiModelInput.safeParse({ provider: "openai", modelId: "model", apiKey: "key", maxSteps: 0 }).success).toBe(false);
  });
});
