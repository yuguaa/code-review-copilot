import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendDingtalk } from '../../shared/dingtalk/dingtalk.service';
import { prisma } from '../../infrastructure/prisma/prisma.service';
import {
  resolveDingtalkConfig,
  sendReviewDingtalkNotification,
  type DingtalkRepositoryConfig,
} from './notifications.service';

vi.mock('../../infrastructure/prisma/prisma.service', () => ({
  prisma: {
    notificationSetting: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../shared/dingtalk/dingtalk.service', () => ({
  sendDingtalk: vi.fn().mockResolvedValue(undefined),
}));

const repo: DingtalkRepositoryConfig = {
  enableDingtalk: true,
  dingtalkWebhook: null,
  dingtalkSecret: null,
};

describe('notifications.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('仓库关闭钉钉时不读取全局配置并跳过', async () => {
    await expect(
      sendReviewDingtalkNotification({ ...repo, enableDingtalk: false }, '标题', '正文'),
    ).resolves.toBe('skipped');

    expect(prisma.notificationSetting.findUnique).not.toHaveBeenCalled();
    expect(sendDingtalk).not.toHaveBeenCalled();
  });

  it('仓库配置优先于全局配置', () => {
    expect(
      resolveDingtalkConfig(
        { ...repo, dingtalkWebhook: 'https://repo.example', dingtalkSecret: 'repo-secret' },
        {
          dingtalkEnabled: true,
          dingtalkWebhookUrl: 'https://global.example',
          dingtalkSecret: 'global-secret',
        },
      ),
    ).toEqual({ webhook: 'https://repo.example', secret: 'repo-secret' });
  });

  it('仓库未配置 webhook 时使用启用的全局配置', async () => {
    vi.mocked(prisma.notificationSetting.findUnique).mockResolvedValue({
      id: 'n1',
      scope: 'global',
      dingtalkEnabled: true,
      dingtalkWebhookUrl: 'https://global.example',
      dingtalkSecret: 'global-secret',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(sendReviewDingtalkNotification(repo, '标题', '正文')).resolves.toBe('sent');
    expect(sendDingtalk).toHaveBeenCalledWith({ webhook: 'https://global.example', secret: 'global-secret' }, '标题', '正文');
  });

  it('缺少可用 webhook 时跳过', async () => {
    vi.mocked(prisma.notificationSetting.findUnique).mockResolvedValue({
      id: 'n1',
      scope: 'global',
      dingtalkEnabled: true,
      dingtalkWebhookUrl: null,
      dingtalkSecret: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(sendReviewDingtalkNotification(repo, '标题', '正文')).resolves.toBe('skipped');
    expect(sendDingtalk).not.toHaveBeenCalled();
  });
});
