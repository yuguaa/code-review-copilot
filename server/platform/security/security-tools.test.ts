import { describe, expect, it } from "vitest";

import { safeHeaderRecord } from "./security-tools";

describe("安全测试请求头遮蔽", () => {
  it("遮蔽固定凭据头和扩展认证头", () => {
    expect(safeHeaderRecord({
      Authorization: "Bearer secret",
      "X-Auth-Token": "token-value",
      "X-Access-Token": "access-value",
      "X-CSRF-Token": "csrf-value",
      "X-API-Key": "api-key-value",
      Cookie: "session=value",
      Accept: "application/json",
    })).toEqual({
      Authorization: "[REDACTED]",
      "X-Auth-Token": "[REDACTED]",
      "X-Access-Token": "[REDACTED]",
      "X-CSRF-Token": "[REDACTED]",
      "X-API-Key": "[REDACTED]",
      Cookie: "[REDACTED]",
      Accept: "application/json",
    });
  });
});
