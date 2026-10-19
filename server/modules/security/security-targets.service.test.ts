import { describe, expect, it } from "vitest";

import { securityIdentityInput, securityIdentityUpdateInput, securityTargetInput, securityTargetUpdateInput } from "./security-targets.service";

const target = {
  name: "生产环境",
  baseUrl: "https://example.com",
  scopeDomains: ["example.com"],
  authorizationOwner: "安全团队",
  authorizationReference: "AUTH-2026-1",
  authorizedUntil: "2026-10-20T08:00:00.000Z",
};

describe("安全测试目标输入", () => {
  it("创建目标时填充计划与范围默认值", () => {
    expect(securityTargetInput.parse(target)).toMatchObject({
      scopeDomains: ["example.com"],
      scheduleEnabled: false,
      scheduleIntervalMinutes: 1440,
      isActive: true,
      maxDurationMinutes: 30,
    });
  });

  it("拒绝未知字段、非 HTTP 地址和无效计划参数", () => {
    expect(securityTargetInput.safeParse({ ...target, nextScheduledAt: "2026-10-20T00:00:00.000Z" }).success).toBe(false);
    expect(securityTargetInput.safeParse({ ...target, baseUrl: "file:///etc/passwd" }).success).toBe(false);
    expect(securityTargetInput.safeParse({ ...target, scheduleIntervalMinutes: 0 }).success).toBe(false);
    expect(securityTargetInput.safeParse({ ...target, maxDurationMinutes: 1.5 }).success).toBe(false);
    expect(securityTargetInput.safeParse({ ...target, scopeDomains: [1] }).success).toBe(false);
  });

  it("部分更新不会补入创建默认值", () => {
    expect(securityTargetUpdateInput.parse({ name: "更新名称" })).toEqual({ name: "更新名称" });
    expect(securityTargetUpdateInput.parse({ scheduleEnabled: false, scheduleIntervalMinutes: 60 }))
      .toEqual({ scheduleEnabled: false, scheduleIntervalMinutes: 60 });
  });
});

describe("安全测试身份输入", () => {
  it("创建身份必须提供密码", () => {
    expect(securityIdentityInput.safeParse({ name: "测试账号", username: "tester" }).success).toBe(false);
    expect(securityIdentityInput.parse({ name: "测试账号", username: "tester", password: "secret" }))
      .toMatchObject({ role: "user", isActive: true });
  });

  it("更新身份允许空密码以保留已有凭据", () => {
    expect(securityIdentityUpdateInput.parse({ password: "" })).toEqual({ password: "" });
    expect(securityIdentityUpdateInput.safeParse({ password: 123 }).success).toBe(false);
  });
});
