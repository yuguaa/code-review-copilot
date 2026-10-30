import { describe, expect, it } from "vitest";

import { parseOcrResult, renderOcrReport, reviewStatus, tokenUsageFromOcrResult } from "./ocr-result";

describe("OCR 结果", () => {
  it("未知状态和无效位置立即失败", () => {
    expect(() => parseOcrResult(JSON.stringify({ status: "success", comments: [] }))).toThrow();
    expect(() => parseOcrResult(JSON.stringify({ status: "complete", comments: [{ path: "app.ts", content: "问题", start_line: -1, end_line: 1 }] }))).toThrow();
  });
  it("保留覆盖失败状态与实际退出码", () => {
    expect(reviewStatus(parseOcrResult(JSON.stringify({ status: "partial", comments: [] })), 0)).toBe("partial");
    expect(reviewStatus(parseOcrResult(JSON.stringify({ status: "complete", comments: [] })), 1)).toBe("failed");
    expect(reviewStatus(parseOcrResult(JSON.stringify({ status: "skipped", comments: [] })), 0)).toBe("skipped");
  });
  it("报告保存证据、建议与覆盖警告并正确包围代码", () => {
    const result = parseOcrResult(JSON.stringify({ status: "partial", comments: [{ path: "app.ts", content: "权限检查缺失", start_line: 3, end_line: 3, existing_code: "```", suggestion_code: "authorize()" }], warnings: ["一个文件未完成"] }));
    const report = renderOcrReport(result, { baseSha: "a".repeat(40), headSha: "b".repeat(40) });
    expect(report).toContain("app.ts:3");
    expect(report).toContain("一个文件未完成");
    expect(report).toContain("````\n```\n````");
  });
  it("从 OCR 汇总中提取 Token 使用量", () => {
    expect(tokenUsageFromOcrResult({
      status: "complete", comments: [],
      summary: { input_tokens: 100, output_tokens: 20, total_tokens: 120, cache_read_tokens: 30 },
    })).toEqual({ inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadTokens: 30 });
    expect(tokenUsageFromOcrResult({ status: "running" })).toBeNull();
  });
});
