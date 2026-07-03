import { prisma } from '../../infrastructure/prisma/prisma.service';
import type { NotificationPayload } from './settings.types';

function maskNotification(setting: { dingtalkSecret?: string | null; dingtalkEnabled?: boolean; dingtalkWebhookUrl?: string | null } | null) {
  return {
    dingtalkEnabled: setting?.dingtalkEnabled ?? false,
    dingtalkWebhookUrl: setting?.dingtalkWebhookUrl ?? null,
    hasDingtalkSecret: Boolean(setting?.dingtalkSecret),
  };
}

export async function loadNotificationSetting() {
  const setting = await prisma.notificationSetting.findUnique({ where: { scope: 'global' } });
  return maskNotification(setting);
}

export async function updateNotificationSetting(body: NotificationPayload) {
  const data: Record<string, unknown> = {};
  if (body.dingtalkEnabled !== undefined) data.dingtalkEnabled = body.dingtalkEnabled;
  if (body.dingtalkWebhookUrl !== undefined) data.dingtalkWebhookUrl = body.dingtalkWebhookUrl || null;
  if (typeof body.dingtalkSecret === 'string' && body.dingtalkSecret.length > 0) data.dingtalkSecret = body.dingtalkSecret;
  const setting = await prisma.notificationSetting.upsert({
    where: { scope: 'global' },
    create: {
      scope: 'global',
      dingtalkEnabled: Boolean(data.dingtalkEnabled),
      dingtalkWebhookUrl: typeof data.dingtalkWebhookUrl === 'string' ? data.dingtalkWebhookUrl : null,
      dingtalkSecret: typeof data.dingtalkSecret === 'string' ? data.dingtalkSecret : null,
    },
    update: data,
  });
  return maskNotification(setting);
}
