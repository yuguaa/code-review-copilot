type SecurityReportTarget = {
  name?: string;
  baseUrl?: string;
  repositoryId?: string | null;
  scopeDomains?: unknown;
  authorizationOwner?: string;
  authorizationReference?: string;
  authorizedUntil?: Date | string | null;
};

type SecurityReportFinding = {
  severity?: string;
  confidence?: string;
  category?: string | null;
  title?: string;
  description?: string;
  evidence?: string;
  remediation?: string;
  status?: string;
};

type SecurityReportTraffic = {
  method?: string;
  url?: string;
  statusCode?: number | null;
  durationMs?: number;
};

type SecurityReportArtifact = {
  type?: string;
  filename?: string;
  mimeType?: string;
  sha256?: string;
  sizeBytes?: number;
};

export type SecurityReportTicket = {
  id?: string;
  status?: string;
  summary?: string | null;
  report?: string | null;
  riskScore?: number | null;
  modelProvider?: string | null;
  modelId?: string | null;
  skillVersion?: string | null;
  requestedAt?: Date | string | null;
  startedAt?: Date | string | null;
  finishedAt?: Date | string | null;
  target?: SecurityReportTarget | null;
  findings?: SecurityReportFinding[];
  traffic?: SecurityReportTraffic[];
  artifacts?: SecurityReportArtifact[];
};

export function buildSecurityReport(ticket: SecurityReportTicket): string {
  const target = ticket.target ?? {};
  const findings = ticket.findings ?? [];
  const traffic = ticket.traffic ?? [];
  const artifacts = ticket.artifacts ?? [];
  const scopeDomains = stringArray(target.scopeDomains);
  const lines = [
    "# 安全测试报告",
    "",
    `- 工单：${text(ticket.id)}`,
    `- 状态：${text(ticket.status)}`,
    `- 目标：${text(target.name)}`,
    `- 地址：${text(target.baseUrl)}`,
    `- 风险评分：${ticket.riskScore == null ? "未提供" : ticket.riskScore}`,
    `- 请求时间：${formatDate(ticket.requestedAt)}`,
    `- 开始时间：${formatDate(ticket.startedAt)}`,
    `- 完成时间：${formatDate(ticket.finishedAt)}`,
    `- 授权人：${text(target.authorizationOwner)}`,
    `- 授权依据：${text(target.authorizationReference)}`,
    `- 授权截止时间：${formatDate(target.authorizedUntil)}`,
    `- 模型：${[ticket.modelProvider, ticket.modelId].filter(Boolean).join(" / ") || "未提供"}`,
    `- 技能版本：${text(ticket.skillVersion)}`,
    "",
    "## 摘要",
    "",
    ticket.summary?.trim() || "未提供",
  ];

  if (scopeDomains.length) {
    lines.push("", "## 测试范围", "", ...scopeDomains.map((domain) => `- ${domain}`));
  }
  if (ticket.report?.trim()) {
    lines.push("", "## 测试报告", "", ticket.report.trim());
  }
  if (findings.length) {
    lines.push("", "## 发现", "", "| 严重程度 | 置信度 | 标题 | 状态 |", "| --- | --- | --- | --- |");
    findings.forEach((finding) => {
      lines.push(`| ${[finding.severity, finding.confidence, finding.title, finding.status].map((value) => escapeMarkdownCell(value)).join(" | ")} |`);
    });
    findings.forEach((finding, index) => {
      lines.push("", `### ${index + 1}. ${text(finding.title)}`, "", `- 分类：${text(finding.category)}`, `- 说明：${text(finding.description)}`, `- 证据：${text(finding.evidence)}`, `- 修复建议：${text(finding.remediation)}`);
    });
  }
  if (traffic.length) {
    lines.push("", "## 请求记录", "", "| 方法 | 地址 | 状态码 | 耗时 |", "| --- | --- | --- | --- |");
    traffic.forEach((item) => {
      lines.push(`| ${escapeMarkdownCell(item.method)} | ${escapeMarkdownCell(item.url)} | ${item.statusCode ?? ""} | ${item.durationMs == null ? "" : `${item.durationMs} ms`} |`);
    });
  }
  if (artifacts.length) {
    lines.push("", "## 证据文件", "");
    artifacts.forEach((artifact) => {
      lines.push(`- ${text(artifact.filename)}（${text(artifact.type)}，${text(artifact.mimeType)}，${artifact.sizeBytes == null ? "大小未知" : `${artifact.sizeBytes} 字节`}）`);
      if (artifact.sha256) lines.push(`  - SHA-256：${artifact.sha256}`);
    });
  }
  return `${lines.join("\n").trim()}\n`;
}

export function buildSecurityReportHtml(ticket: SecurityReportTicket): string {
  const target = ticket.target ?? {};
  const findings = ticket.findings ?? [];
  const traffic = ticket.traffic ?? [];
  const artifacts = ticket.artifacts ?? [];
  const scopeDomains = stringArray(target.scopeDomains);
  const findingRows = findings.map((finding) => `<tr><td>${escapeHtml(finding.severity)}</td><td>${escapeHtml(finding.confidence)}</td><td>${escapeHtml(finding.title)}</td><td>${escapeHtml(finding.status)}</td></tr>`).join("");
  const findingDetails = findings.map((finding, index) => `<section><h3>${index + 1}. ${escapeHtml(finding.title)}</h3><p><strong>分类：</strong>${escapeHtml(finding.category)}</p><p><strong>说明：</strong>${escapeHtml(finding.description)}</p><p><strong>证据：</strong>${escapeHtml(finding.evidence)}</p><p><strong>修复建议：</strong>${escapeHtml(finding.remediation)}</p></section>`).join("");
  const trafficRows = traffic.map((item) => `<tr><td>${escapeHtml(item.method)}</td><td>${escapeHtml(item.url)}</td><td>${escapeHtml(item.statusCode)}</td><td>${item.durationMs == null ? "" : `${item.durationMs} ms`}</td></tr>`).join("");
  const artifactItems = artifacts.map((artifact) => `<li><strong>${escapeHtml(artifact.filename)}</strong><span>${escapeHtml(artifact.type)} · ${escapeHtml(artifact.mimeType)} · ${artifact.sizeBytes == null ? "大小未知" : `${artifact.sizeBytes} 字节`}</span>${artifact.sha256 ? `<code>${escapeHtml(artifact.sha256)}</code>` : ""}</li>`).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>安全测试报告</title>
<style>
body{margin:0;background:#f4f1ea;color:#20201d;font:15px/1.65 Georgia,"Noto Serif SC",serif}
main{max-width:960px;margin:0 auto;padding:48px 24px}
h1,h2,h3{font-family:"Noto Sans SC",sans-serif;line-height:1.25}
h1{font-size:36px;margin:0 0 24px}
h2{margin-top:40px;border-bottom:1px solid #c9c2b5;padding-bottom:8px}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px 24px;margin:0}
.meta div{padding:12px;background:#fffdf8;border:1px solid #d8d1c4}
.meta dt{color:#6f695f;font-size:12px}.meta dd{margin:4px 0 0}
table{width:100%;border-collapse:collapse;background:#fffdf8}th,td{text-align:left;padding:10px;border:1px solid #d8d1c4}th{background:#ebe5da}
.report{white-space:pre-wrap;overflow-wrap:anywhere;background:#fffdf8;border:1px solid #d8d1c4;padding:20px}
section{background:#fffdf8;border:1px solid #d8d1c4;padding:16px 20px;margin:12px 0}
ul{padding-left:22px}li{margin:8px 0}li span{margin-left:10px;color:#6f695f}li code{display:block;margin-top:4px;color:#6f695f}
</style>
</head>
<body>
<main>
<h1>安全测试报告</h1>
<dl class="meta">
<div><dt>工单</dt><dd>${escapeHtml(ticket.id)}</dd></div>
<div><dt>状态</dt><dd>${escapeHtml(ticket.status)}</dd></div>
<div><dt>目标</dt><dd>${escapeHtml(target.name)}</dd></div>
<div><dt>地址</dt><dd>${escapeHtml(target.baseUrl)}</dd></div>
<div><dt>风险评分</dt><dd>${ticket.riskScore == null ? "未提供" : ticket.riskScore}</dd></div>
<div><dt>请求时间</dt><dd>${formatDate(ticket.requestedAt)}</dd></div>
<div><dt>开始时间</dt><dd>${formatDate(ticket.startedAt)}</dd></div>
<div><dt>完成时间</dt><dd>${formatDate(ticket.finishedAt)}</dd></div>
<div><dt>授权人</dt><dd>${escapeHtml(target.authorizationOwner)}</dd></div>
<div><dt>授权依据</dt><dd>${escapeHtml(target.authorizationReference)}</dd></div>
<div><dt>授权截止时间</dt><dd>${formatDate(target.authorizedUntil)}</dd></div>
<div><dt>模型</dt><dd>${escapeHtml([ticket.modelProvider, ticket.modelId].filter(Boolean).join(" / ") || "未提供")}</dd></div>
<div><dt>技能版本</dt><dd>${escapeHtml(ticket.skillVersion)}</dd></div>
</dl>
<h2>摘要</h2>
<p>${escapeHtml(ticket.summary) || "未提供"}</p>
${scopeDomains.length ? `<h2>测试范围</h2><ul>${scopeDomains.map((domain) => `<li>${escapeHtml(domain)}</li>`).join("")}</ul>` : ""}
${ticket.report?.trim() ? `<h2>测试报告</h2><pre class="report">${escapeHtml(ticket.report)}</pre>` : ""}
${findings.length ? `<h2>发现</h2><table><thead><tr><th>严重程度</th><th>置信度</th><th>标题</th><th>状态</th></tr></thead><tbody>${findingRows}</tbody></table>${findingDetails}` : ""}
${traffic.length ? `<h2>请求记录</h2><table><thead><tr><th>方法</th><th>地址</th><th>状态码</th><th>耗时</th></tr></thead><tbody>${trafficRows}</tbody></table>` : ""}
${artifacts.length ? `<h2>证据文件</h2><ul>${artifactItems}</ul>` : ""}
</main>
</body>
</html>`;
}

function text(value: unknown): string {
  if (value == null || value === "") return "未提供";
  return String(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "未提供";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("报告时间格式无效");
  return date.toISOString();
}

function escapeMarkdownCell(value: unknown): string {
  return text(value).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function escapeHtml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
