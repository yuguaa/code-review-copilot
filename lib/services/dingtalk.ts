/**
 * @file dingtalk.ts
 * @description 钉钉机器人通知服务
 */

import crypto from "crypto";
import type { ReviewLog } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createLogger, logWarn } from "@/lib/logger";

const log = createLogger("DingTalk");

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

function compactText(input: string, maxLen: number): string {
  const text = input.replace(/\s+/g, " ").trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

export function sanitizeDingTalkReviewMarkdown(markdown: string): string {
  return markdown
    // 钉钉群通知保留问题详情和审查来源，原始模型 JSON/追溯材料留在 GitLab 详情里。
    .replace(/(?:^|\n)###\s*各机器人原始评价[\s\S]*?(?=\n<sub>|$)/g, "")
    .replace(/<details>[\s\S]*?<\/details>/g, "")
    .replace(/<sub>([\s\S]*?)<\/sub>/g, "$1")
    .replace(/###\s*全部问题清单/g, "### 问题详情（含审查来源）")
    .replace(/###\s*审查机器人结果/g, "### 审查来源汇总")
    .replace(/Actionable comments posted:\s*\*\*(\d+)\*\*/g, "需处理评论：$1")
    .replace(/Nitpick comments:\s*\*\*(\d+)\*\*/g, "建议类评论：$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function sendReviewToDingTalk(params: {
  reviewLog: ReviewLog;
  repositoryName: string;
  repositoryPath: string;
  gitlabUrl: string;
  messageOverride: string;
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
    log.info("⏭️ [DingTalk] Notification disabled or webhook not configured, skip");
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

  lines.push(sanitizeDingTalkReviewMarkdown(params.messageOverride));

  if (link) {
    lines.push("");
    lines.push(`[查看 GitLab 详情](${link})`);
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
      log.warn("⚠️ [DingTalk] Failed to send message", { status: result.status, responseText: result.text });
    } else {
      log.info("✅ [DingTalk] Notification sent");
    }
  } catch (error) {
    logWarn(log, error, "⚠️ [DingTalk] Failed to send message");
  }
}
