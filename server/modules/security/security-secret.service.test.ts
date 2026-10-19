import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "./security-secret.service";

const originalSecret = process.env.APP_AUTH_SESSION_SECRET;

beforeAll(() => {
  process.env.APP_AUTH_SESSION_SECRET = "security-secret-test-key";
});

afterAll(() => {
  if (originalSecret === undefined) delete process.env.APP_AUTH_SESSION_SECRET;
  else process.env.APP_AUTH_SESSION_SECRET = originalSecret;
});

describe("安全测试身份凭据", () => {
  it("使用随机向量加密并还原原文", () => {
    const first = encryptSecret("password-123");
    const second = encryptSecret("password-123");
    expect(first).not.toBe(second);
    expect(first).not.toContain("password-123");
    expect(decryptSecret(first)).toBe("password-123");
    expect(decryptSecret(second)).toBe("password-123");
  });

  it("拒绝格式无效的密文", () => {
    expect(() => decryptSecret("invalid")).toThrow("格式无效");
  });

  it("密钥变化后认证标签校验失败", () => {
    const ciphertext = encryptSecret("password-123");
    process.env.APP_AUTH_SESSION_SECRET = "another-security-key";
    expect(() => decryptSecret(ciphertext)).toThrow();
  });
});
