import { describe, expect, it } from "vitest";

import { assertUrlInScope, isUrlInScope } from "./security-scope";

describe("安全测试范围", () => {
  it("允许精确域名与 http 或 https 地址", () => {
    expect(assertUrlInScope("https://example.com/api", ["example.com"]).hostname).toBe("example.com");
    expect(assertUrlInScope("http://EXAMPLE.com./health", ["example.com"]).hostname).toBe("example.com.");
  });

  it("完整子域名需要单独授权", () => {
    const scope = ["api.example.com"];
    expect(assertUrlInScope("https://api.example.com/users", scope).hostname).toBe("api.example.com");
    expect(() => assertUrlInScope("https://dev.api.example.com/users", scope)).toThrow("授权范围");
    expect(() => assertUrlInScope("https://example.com", scope)).toThrow("授权范围");
  });

  it("拒绝相似域名和其他协议", () => {
    const scope = ["example.com"];
    expect(() => assertUrlInScope("https://example.com.evil.test", scope)).toThrow("授权范围");
    expect(() => assertUrlInScope("https://notexample.com", scope)).toThrow("授权范围");
    expect(() => assertUrlInScope("ftp://example.com", scope)).toThrow("http");
    expect(() => assertUrlInScope("file:///etc/passwd", scope)).toThrow("http");
  });

  it("拒绝包含用户名或密码的地址", () => {
    expect(() => assertUrlInScope("https://user@example.com", ["example.com"])).toThrow("用户名");
    expect(() => assertUrlInScope("https://user:secret@example.com", ["example.com"])).toThrow("用户名");
  });

  it("空范围、无效格式与无效通配符立即失败", () => {
    expect(() => assertUrlInScope("https://example.com", [])).toThrow("授权范围");
    expect(() => assertUrlInScope("not a url", ["example.com"])).toThrow("格式");
    expect(() => assertUrlInScope("https://api.example.com", ["api.*.com"])).toThrow("授权范围");
    expect(() => assertUrlInScope("https://api.example.com", ["*.example.com"])).toThrow("授权范围");
  });

  it("浏览器网络事件可以安全筛选范围外地址", () => {
    expect(isUrlInScope("https://api.example.com/users", ["api.example.com"])).toBe(true);
    expect(isUrlInScope("https://example.com.evil.test", ["example.com"])).toBe(false);
    expect(isUrlInScope("ws://api.example.com/socket", ["api.example.com"])).toBe(false);
    expect(isUrlInScope("not a url", ["example.com"])).toBe(false);
  });
});
