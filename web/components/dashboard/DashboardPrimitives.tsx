import type { ComponentType } from 'react';
import type { ChartConfig } from '../chart';
import { Card, ColorBlock } from '../ui/surface';
import { cn } from '../../lib/cn';
import type { DashboardBucket, RecentItem } from '../../hooks/useDashboardData';

type IconComponent = ComponentType<{ size?: number; className?: string }>;

export const chartColors = {
  ink: '#17201c',
  muted: '#758078',
  hairline: '#dce4da',
  lime: '#9ec46a',
  mint: '#b7d8bf',
  coral: '#c25f52',
  teal: '#315f50',
  lilac: '#d7dfd1',
};

export const trendChartConfig = {
  total: { label: '会话', color: chartColors.ink },
  completed: { label: '完成', color: chartColors.teal },
  failed: { label: '失败', color: chartColors.coral },
} satisfies ChartConfig;

export const statusChartConfig = {
  completed: { label: '完成', color: chartColors.mint },
  failed: { label: '失败', color: chartColors.coral },
  running: { label: '运行中', color: chartColors.lime },
} satisfies ChartConfig;

export const authorChartConfig = {
  total: { label: '会话', color: chartColors.ink },
  failed: { label: '失败', color: chartColors.coral },
  avgMessagesPerSession: { label: '均消息', color: chartColors.lilac },
} satisfies ChartConfig;

export const repositoryChartConfig = {
  total: { label: '会话', color: chartColors.teal },
} satisfies ChartConfig;

export const statusColor: Record<string, string> = {
  completed: 'bg-[var(--brand-mint)] text-[var(--ink)]',
  failed: 'bg-[var(--brand-coral)] text-white',
  running: 'bg-[var(--brand-cream)] text-[var(--ink)]',
};

export function fmtTime(value: string | null): string {
  if (!value) return '暂无';
  return new Date(value).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function branchText(item: RecentItem): string {
  if (item.sourceBranch && item.targetBranch) return `${item.sourceBranch} -> ${item.targetBranch}`;
  return item.sourceBranch ?? item.targetBranch ?? '未记录分支';
}

export function chartHeight(items: unknown[], min = 280, row = 36): number {
  return Math.max(min, items.length * row);
}

export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'white',
}: {
  label: string;
  value: string | number;
  hint: string;
  icon: IconComponent;
  tone?: 'white' | 'lime' | 'coral' | 'navy';
}) {
  const content = (
    <div className="flex min-h-24 items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="eyebrow opacity-70">{label}</p>
        <p className="mt-2 font-display text-3xl tabular-nums">{value}</p>
        <p className="mt-1 truncate text-xs opacity-70">{hint}</p>
      </div>
      <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--r-pill)] border', tone === 'white' ? 'border-[var(--line-default)] bg-[var(--surface-card)] text-[var(--ink)]' : 'border-white/20 bg-white/20')}>
        <Icon size={18} />
      </span>
    </div>
  );

  if (tone === 'white') return <Card className="p-5">{content}</Card>;
  return (
    <ColorBlock tone={tone} className="p-5 shadow-[0_18px_42px_-36px_rgba(7,26,18,0.52)]">
      {content}
    </ColorBlock>
  );
}

export function SectionTitle({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <h2 className="font-display text-lg text-[var(--ink)]">{title}</h2>
      {meta && <span className="caption text-[var(--muted)]">{meta}</span>}
    </div>
  );
}

export function SignalCard({
  label,
  bucket,
  value,
  icon: Icon,
}: {
  label: string;
  bucket: DashboardBucket | null;
  value: (bucket: DashboardBucket) => string;
  icon: IconComponent;
}) {
  return (
    <div className="rounded-[var(--r-md)] border border-[var(--line-default)] bg-[var(--surface-soft)] p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="eyebrow text-[var(--muted)]">{label}</span>
        <Icon size={16} className="text-[var(--muted)]" />
      </div>
      <p className="mt-3 truncate text-sm font-semibold text-[var(--ink)]">{bucket?.label ?? '暂无'}</p>
      <p className="caption mt-1 text-[var(--muted)]">{bucket ? value(bucket) : 'NO DATA'}</p>
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return <div className="flex h-56 items-center justify-center text-sm text-[var(--muted)]">{label}</div>;
}
