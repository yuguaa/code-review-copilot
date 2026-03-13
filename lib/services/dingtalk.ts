/**
 * @file dingtalk.ts
 * @description 钉钉机器人通知服务
 */

import crypto from "crypto";
import type { ReviewLog } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface DingTalkMarkdownMessage {
  msgtype: "markdown";
  markdown: {
    title: string;
    text: string;
  };
}

export function signWebhookUrl(webhookUrl: string, secret?: string | null): string {
  if (!secret) return webhookUrl;

  const timestamp = Date.now();
  const stringToSign = `${timestamp}\n${secret}`;
  const sign = encodeURIComponent(
    crypto.createHmac("sha256", secret).update(stringToSign).digest("base64"),
  );

  const url = new URL(webhookUrl);
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", sign);
  return url.toString();
}

export async function sendDingTalkMarkdownMessage(params: {
  webhookUrl: string;
  secret?: string | null;
  payload: DingTalkMarkdownMessage;
}): Promise<{ ok: boolean; status: number; text?: string }> {
  const signedWebhookUrl = signWebhookUrl(params.webhookUrl, params.secret);
  const response = await fetch(signedWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params.payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return { ok: false, status: response.status, text: errorText };
  }

  return { ok: true, status: response.status };
}

function buildGitlabLink(reviewLog: ReviewLog, baseUrl: string, repositoryPath: string): string | null {
  const base = baseUrl.replace(/\/+$/, "");
  if (!base || !repositoryPath) return null;

  if (reviewLog.mergeRequestIid && reviewLog.mergeRequestIid !== 0) {
    return `${base}/${repositoryPath}/-/merge_requests/${reviewLog.mergeRequestIid}/diffs`;
  }

  if (reviewLog.commitSha) {
    return `${base}/${repositoryPath}/-/commit/${reviewLog.commitSha}`;
  }

  return `${base}/${repositoryPath}`;
}

function getReviewConclusion(critical: number, normal: number, suggestion: number): string {
  if (critical > 0) return `高风险：发现 ${critical} 个严重问题，建议修复后再合并`;
  if (normal > 0) return `中风险：无严重问题，但有 ${normal} 个一般问题需要关注`;
  if (suggestion > 0) return `低风险：仅有 ${suggestion} 条优化建议`;
  return "通过：未发现明显问题";
}

function compactText(input: string, maxLen: number): string {
  const text = input.replace(/\s+/g, " ").trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

export async function sendReviewToDingTalk(params: {
  reviewLog: ReviewLog;
  repositoryName: string;
  repositoryPath: string;
  gitlabUrl: string;
  messageOverride?: string;
}): Promise<void> {
  const setting = await prisma.notificationSetting.findUnique({
    where: { scope: "global" },
  });

  let webhookUrl = setting?.dingtalkWebhookUrl || null;
  let secret = setting?.dingtalkSecret || null;
  let enabled = setting?.dingtalkEnabled ?? false;

  if (!setting) {
    webhookUrl = process.env.DINGTALK_WEBHOOK_URL || null;
    secret = process.env.DINGTALK_SECRET || null;
    enabled = Boolean(webhookUrl);
  }

  if (!enabled || !webhookUrl) {
    console.log("⏭️ [DingTalk] Notification disabled or webhook not configured, skip");
    return;
  }

  const { reviewLog, repositoryName, repositoryPath, gitlabUrl } = params;
  const link = buildGitlabLink(reviewLog, gitlabUrl, repositoryPath);

  const lines: string[] = [];
  const eventLabel = reviewLog.mergeRequestIid && reviewLog.mergeRequestIid !== 0
    ? `MR !${reviewLog.mergeRequestIid}`
    : `Commit ${reviewLog.commitShortId || (reviewLog.commitSha || "").slice(0, 8)}`;

  lines.push("### 🤖 Code Review 完成");
  lines.push("");
  lines.push(`- 仓库：${repositoryName}`);
  lines.push(`- 事件：${eventLabel}`);
  lines.push(`- 标题：${compactText(reviewLog.title || "", 120)}`);
  lines.push(`- 作者：${reviewLog.author}${reviewLog.authorUsername ? `（${reviewLog.authorUsername}）` : ""}`);
  lines.push(`- 分支：${reviewLog.sourceBranch}${reviewLog.targetBranch ? ` → ${reviewLog.targetBranch}` : ""}`);
  lines.push("");

  if (params.messageOverride) {
    lines.push(params.messageOverride);
    if (link) {
      lines.push("");
      lines.push(`[查看 GitLab 详情](${link})`);
    }
  } else {
    const critical = reviewLog.criticalIssues ?? 0;
    const normal = reviewLog.normalIssues ?? 0;
    const suggestion = reviewLog.suggestions ?? 0;
    const conclusion = getReviewConclusion(critical, normal, suggestion);

    const summary = reviewLog.aiSummary ? compactText(reviewLog.aiSummary, 240) : "";
    lines.push(`- 结论：${conclusion}`);
    lines.push(`- 问题统计：🔴 ${critical} / ⚠️ ${normal} / 💡 ${suggestion}`);
    lines.push(`- 审查文件：${reviewLog.reviewedFiles}/${reviewLog.totalFiles}`);
    if (summary) {
      lines.push("");
      lines.push(`**变更摘要**：${summary}`);
    }
    if (link) {
      lines.push("");
      lines.push(`[查看 GitLab 详情](${link})`);
    }
    lines.push("");
    lines.push(`<sub>完成时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</sub>`);
  }

  const payload: DingTalkMarkdownMessage = {
    msgtype: "markdown",
    markdown: {
      title: `Code Review 完成 - ${repositoryName}`,
      text: lines.join("\n"),
    },
  };

  try {
    const result = await sendDingTalkMarkdownMessage({
      webhookUrl,
      secret,
      payload,
    });

    if (!result.ok) {
      console.warn(`⚠️ [DingTalk] Failed to send message: ${result.status} ${result.text ?? ""}`);
    } else {
      console.log("✅ [DingTalk] Notification sent");
    }
  } catch (error) {
    console.warn("⚠️ [DingTalk] Failed to send message", error);
  }
}
