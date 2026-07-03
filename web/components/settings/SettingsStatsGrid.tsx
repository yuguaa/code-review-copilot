import { ColorBlock } from '../ui';
import type { Stats } from '../../hooks/useSettingsPageData';

export function SettingsStatsGrid({ stats }: { stats: Stats | null }) {
  if (!stats) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {([
        ['仓库', `${stats.activeRepositoryCount}/${stats.repositoryCount}`, '启用 / 总数', 'pink'],
        ['模型', String(stats.modelCount), '可用全局模型', 'lavender'],
        ['会话', String(stats.sessionCount), `审查 ${stats.reviewSessionCount} · 对话 ${stats.chatSessionCount}`, 'peach'],
        ['消息', String(stats.messageCount), stats.latestSessionAt ? `最近 ${new Date(stats.latestSessionAt).toLocaleString()}` : '暂无会话', 'cream'],
      ] as const).map(([label, value, hint, tone]) => (
        <ColorBlock key={label} tone={tone === 'lavender' ? 'lilac' : tone === 'peach' ? 'mint' : tone} className="space-y-1 p-5">
          <p className="eyebrow opacity-70">{label}</p>
          <p className="font-display text-3xl tabular-nums">{value}</p>
          <p className="caption truncate opacity-70">{hint}</p>
        </ColorBlock>
      ))}
    </div>
  );
}
