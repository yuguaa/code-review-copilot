import { describe, expect, it } from "vitest";

import { repositoryInput } from "./repositories.service";

const repository = { gitLabAccountId: "account-1", gitLabProjectId: 1, name: "repository", path: "team/repository" };

describe("仓库配置输入", () => {
  it("创建时提供 OCR 默认参数", () => {
    expect(repositoryInput.parse(repository)).toMatchObject({
      ocrConcurrency: 2, ocrTimeoutMinutes: 10, ocrMaxTokensBudget: 200000, enableDingtalk: false,
    });
  });
  it.each([0, -1, 1.5, "2", null, Number.POSITIVE_INFINITY])("拒绝无效 OCR 参数 %s", (value) => {
    for (const key of ["ocrConcurrency", "ocrTimeoutMinutes", "ocrMaxTokensBudget"]) {
      expect(repositoryInput.safeParse({ ...repository, [key]: value }).success).toBe(false);
    }
  });
  it("部分更新不填充创建默认值", () => {
    expect(repositoryInput.partial().parse({ name: "new-name" })).toEqual({ name: "new-name" });
  });
  it("空白凭证保留原值，null 清除可选凭证", () => {
    for (const key of ["customApiKey"]) {
      expect(repositoryInput.partial().parse({ [key]: " " })[key as "customApiKey"]).toBeUndefined();
      expect(repositoryInput.partial().parse({ [key]: null })[key as "customApiKey"]).toBeNull();
    }
  });
  it("拒绝平台记忆、Tools 和 Skills 参数", () => {
    for (const key of ["memory", "enabledTools", "enabledSkills"]) {
      expect(repositoryInput.safeParse({ ...repository, [key]: [] }).success).toBe(false);
    }
  });
});
