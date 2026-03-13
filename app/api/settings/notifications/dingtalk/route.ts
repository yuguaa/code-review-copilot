/**
 * @file /api/settings/notifications/dingtalk
 * @description 钉钉机器人配置 API（全局）
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const DEFAULT_SCOPE = "global";

/** GET /api/settings/notifications/dingtalk - 获取钉钉配置 */
export async function GET() {
  try {
    const setting = await prisma.notificationSetting.findUnique({
      where: { scope: DEFAULT_SCOPE },
    });
    return NextResponse.json(setting ?? null);
  } catch (error) {
    console.error("Failed to fetch DingTalk setting:", error);
    return NextResponse.json(
      { error: "Failed to fetch DingTalk setting" },
      { status: 500 },
    );
  }
}

/** POST /api/settings/notifications/dingtalk - 创建或更新钉钉配置 */
export async function POST(request: NextRequest) {
  return upsertSetting(request);
}

/** PUT /api/settings/notifications/dingtalk - 更新钉钉配置 */
export async function PUT(request: NextRequest) {
  return upsertSetting(request);
}

async function upsertSetting(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      dingtalkWebhookUrl,
      dingtalkSecret,
      dingtalkEnabled,
    } = body;

    if (dingtalkEnabled && !dingtalkWebhookUrl) {
      return NextResponse.json(
        { error: "Webhook URL is required when DingTalk is enabled" },
        { status: 400 },
      );
    }

    const setting = await prisma.notificationSetting.upsert({
      where: { scope: DEFAULT_SCOPE },
      update: {
        dingtalkWebhookUrl: dingtalkWebhookUrl ?? null,
        dingtalkSecret: dingtalkSecret ?? null,
        dingtalkEnabled: Boolean(dingtalkEnabled),
      },
      create: {
        scope: DEFAULT_SCOPE,
        dingtalkWebhookUrl: dingtalkWebhookUrl ?? null,
        dingtalkSecret: dingtalkSecret ?? null,
        dingtalkEnabled: Boolean(dingtalkEnabled),
      },
    });

    return NextResponse.json(setting);
  } catch (error) {
    console.error("Failed to update DingTalk setting:", error);
    return NextResponse.json(
      { error: "Failed to update DingTalk setting" },
      { status: 500 },
    );
  }
}
