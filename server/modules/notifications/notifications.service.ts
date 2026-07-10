import { sendDingtalk, type DingtalkConfig } from '../../shared/dingtalk/dingtalk.service';
import { prisma } from '../../infrastructure/prisma/prisma.service';

export type DingtalkRepositoryConfig = {
  enableDingtalk: boolean;
  dingtalkWebhook: string | null;
  dingtalkSecret: string | null;
};

type NotificationForDingtalk = {
  dingtalkEnabled: boolean;
  dingtalkWebhookUrl: string | null;
  dingtalkSecret: string | null;
} | null;

export function resolveDingtalkConfig(
  repo: DingtalkRepositoryConfig,
  notification: NotificationForDingtalk,
): DingtalkConfig | null {
  if (!repo.enableDingtalk) return null;
  return repo.dingtalkWebhook
    ? { webhook: repo.dingtalkWebhook, secret: repo.dingtalkSecret }
    : notification?.dingtalkEnabled && notification.dingtalkWebhookUrl
      ? { webhook: notification.dingtalkWebhookUrl, secret: notification.dingtalkSecret }
      : null;
}

export async function loadRepositoryDingtalkConfig(repo: DingtalkRepositoryConfig): Promise<DingtalkConfig | null> {
  if (!repo.enableDingtalk) return null;
  const notification = await prisma.notificationSetting.findUnique({ where: { scope: 'global' } });
  return resolveDingtalkConfig(repo, notification);
}

export async function sendRepositoryDingtalkNotification(
  repo: DingtalkRepositoryConfig,
  title: string,
  text: string,
): Promise<'sent' | 'skipped'> {
  const config = await loadRepositoryDingtalkConfig(repo);
  if (!config) return 'skipped';
  await sendDingtalk(config, title, text);
  return 'sent';
}
