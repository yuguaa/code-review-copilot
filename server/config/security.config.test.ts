import { describe, expect, it } from "vitest";

import { parseSecuritySkillNames } from "./security.config";

describe("安全测试 Skill 配置", () => {
  it("解析多个 Skill 并去重", () => {
    expect(parseSecuritySkillNames("hack, api-audit,hack")).toEqual(["hack", "api-audit"]);
  });

  it("默认为 hack", () => {
    expect(parseSecuritySkillNames(undefined)).toEqual(["hack"]);
  });

  it("拒绝空配置和路径穿越名称", () => {
    expect(() => parseSecuritySkillNames("")).toThrow("至少需要");
    expect(() => parseSecuritySkillNames("../hack")).toThrow("名称无效");
    expect(() => parseSecuritySkillNames("hack/api")).toThrow("名称无效");
  });
});
