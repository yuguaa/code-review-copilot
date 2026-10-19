import { describe, expect, it } from "vitest";

import { buildSecurityReport, buildSecurityReportHtml } from "./security-report";

const ticket = {
  id: "ticket-1",
  status: "completed",
  summary: "发现一个高风险问题",
  riskScore: 80,
  requestedAt: "2026-10-19T08:00:00.000Z",
  target: {
    name: "示例目标",
    baseUrl: "https://example.com",
    scopeDomains: ["example.com"],
    authorizationOwner: "安全团队",
    authorizationReference: "AUTH-1",
    authorizedUntil: "2026-10-20T08:00:00.000Z",
  },
  findings: [{
    severity: "high",
    confidence: "high",
    title: "<script>alert('x')</script>",
    description: "响应包含未转义内容 & 敏感信息",
    evidence: "<img src=x onerror=alert(1)>",
    remediation: "修复输出编码",
    status: "open",
  }],
  traffic: [{ method: "GET", url: "https://example.com/?a=1&b=2", statusCode: 200, durationMs: 12 }],
  artifacts: [{ type: "response", filename: "evidence.html", mimeType: "text/html", sizeBytes: 128, sha256: "abc" }],
};

describe("安全测试报告", () => {
  it("生成包含摘要、发现、请求和证据的 Markdown", () => {
    const markdown = buildSecurityReport(ticket);
    expect(markdown).toContain("# 安全测试报告");
    expect(markdown).toContain("| high | high |");
    expect(markdown).toContain("## 请求记录");
    expect(markdown).toContain("evidence.html");
  });

  it("HTML 会转义发现内容与报告正文", () => {
    const html = buildSecurityReportHtml({ ...ticket, report: "<script>report()</script>" });
    expect(html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(html).toContain("&amp; 敏感信息");
    expect(html).toContain("&lt;script&gt;report()&lt;/script&gt;");
    expect(html).not.toContain("<script>alert('x')</script>");
  });
});
