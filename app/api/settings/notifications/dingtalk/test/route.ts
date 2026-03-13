/**
 * @file /api/settings/notifications/dingtalk/test
 * @description 钉钉机器人测试发送
 */

import { NextRequest, NextResponse } from "next/server";
import { sendDingTalkMarkdownMessage } from "@/lib/services/dingtalk";

/** POST /api/settings/notifications/dingtalk/test - 测试钉钉机器人 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { webhookUrl, secret } = body;

    if (!webhookUrl) {
      return NextResponse.json(
        { error: "Webhook URL is required" },
        { status: 400 },
      );
    }

    const payload = {
      msgtype: "markdown" as const,
      markdown: {
        title: "Code Review Copilot 测试消息",
        text: [
          "### 🤖 Code Review Copilot",
          "",
          "- 这是一条钉钉机器人测试消息",
          "- 如果你看到了这条消息，说明配置正确",
          "",
          `<sub>发送时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</sub>`,
        ].join("\n"),
      },
    };

    const result = await sendDingTalkMarkdownMessage({
      webhookUrl,
      secret: secret || null,
      payload,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: `Failed to send message: ${result.status} ${result.text ?? ""}` },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to test DingTalk setting:", error);
    return NextResponse.json(
      { error: "Failed to test DingTalk setting" },
      { status: 500 },
    );
  }
}
