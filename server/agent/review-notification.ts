import type { UIMessage } from 'ai';
import { prisma } from '../lib/prisma';
import { sendDingtalk } from '../lib/dingtalk';
import type { SessionWithRepository } from '../lib/chat-store';

type RepositoryForDingtalk = NonNullable<SessionWithRepository['repository']>;
type NotificationForDingtalk = {
  dingtalkEnabled: boolean;
  dingtalkWebhookUrl: string | null;
  dingtalkSecret: string | null;
} | null;

export function resolveDingtalkConfig(repo: RepositoryForDingtalk, notification: NotificationForDingtalk) {
  return repo.dingtalkWebhook
    ? { webhook: repo.dingtalkWebhook, secret: repo.dingtalkSecret }
    : notification?.dingtalkEnabled && notification.dingtalkWebhookUrl
      ? { webhook: notification.dingtalkWebhookUrl, secret: notification.dingtalkSecret }
      : null;
}

function textOf(messages: UIMessage[]): string {
  const message = [...messages].reverse().find((m) => m.role === 'assistant');
  if (!message) return '';
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function titleOf(session: SessionWithRepository): string {
  const repo = session.repository?.path ?? '未绑定仓库';
  const title = session.mrIid ? `!${session.mrIid} ${session.mrTitle ?? session.title ?? ''}` : session.title ?? '审查完成';
  return `[代码审查] ${repo} ${title}`.trim();
}

function contextOf(session: SessionWithRepository): string {
  const branch =
    session.sourceBranch && session.targetBranch
      ? `${session.sourceBranch} → ${session.targetBranch}`
      : session.sourceBranch ?? session.targetBranch ?? '-';
  return [
    `- 仓库：${session.repository?.path ?? '未绑定仓库'}`,
    `- 分支：${branch}`,
    session.commitSha ? `- Commit：${session.commitSha}` : '',
    session.mrIid ? `- MR：!${session.mrIid}` : '- 类型：Push',
    session.author ? `- 提交者：${session.author}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 后台审查完成后的确定性通知。
 * 钉钉开关仍由仓库控制；机器人配置优先仓库级，缺省走全局配置。
 */
export function notifyReviewCompleted(session: SessionWithRepository, messages: UIMessage[]): Promise<'sent' | 'skipped'> {
  const repo = session.repository;
  if (!repo?.enableDingtalk) return Promise.resolve('skipped');

  return prisma.notificationSetting.findUnique({ where: { scope: 'global' } }).then((notification) => {
    const dingtalk = resolveDingtalkConfig(repo, notification);
    if (!dingtalk) return 'skipped';

    const resultText = textOf(messages) || '审查已完成，但模型没有返回可展示的文本结果。请进入会话查看工具调用记录。';
    const text = [`## ${titleOf(session)}`, '', contextOf(session), '', '---', '', resultText].join('\n');
    return sendDingtalk(dingtalk, titleOf(session), text).then(() => 'sent' as const);
  });
}
