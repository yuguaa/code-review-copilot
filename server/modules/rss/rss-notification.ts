export type RssItem = {
  guid: string;
  title: string;
  link: string | null;
  publishedAt: Date | null;
  summary: string | null;
};

function formatPublishedAt(publishedAt: Date | null): string {
  if (!publishedAt) return '未提供发布时间';
  return publishedAt.toLocaleString('zh-CN', { hour12: false });
}

/** 摘要压缩成单段，避免钉钉消息里出现大段空白与换行。 */
function compactSummary(summary: string | null): string {
  if (!summary) return '';
  const compact = summary.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.length > 180 ? `${compact.slice(0, 180)}…` : compact;
}

/**
 * RSS 推送模板：与代码审查通知共用同一个钉钉机器人，标题与正文结构独立。
 */
export function buildRssDingtalkMessage(
  subscriptionName: string,
  item: RssItem,
): { title: string; text: string } {
  const summary = compactSummary(item.summary);
  const lines = [
    `### 📰 ${subscriptionName}`,
    '',
    `**${item.title}**`,
    '',
    ...(summary ? [summary, ''] : []),
    `> 发布时间：${formatPublishedAt(item.publishedAt)}`,
  ];

  if (item.link) {
    lines.push('', `[阅读全文](${item.link})`);
  }

  return {
    title: `RSS 更新 · ${subscriptionName} · ${item.title}`,
    text: lines.join('\n'),
  };
}
