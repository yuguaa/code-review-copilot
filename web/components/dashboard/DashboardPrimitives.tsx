import type { ComponentType } from 'react';
import type { ChartConfig } from '../chart';
import { Card, ColorBlock } from '../ui/surface';
import { cn } from '../../lib/cn';
import type { DashboardBucket, RecentItem } from '../../hooks/useDashboardData';

type IconComponent = ComponentType<{ size?: number; className?: string }>;

export const chartColors = {
  ink: '#262330',
  muted: '#756f79',
  hairline: '#d9d1c4',
  lime: '#d7dfad',
  mint: '#c7e5e8',
  coral: '#bd5148',
  teal: '#218ca3',
  lilac: '#e4d9ea',
};

export const trendChartConfig = {
  total: { label: '会话', color: chartColors.ink },
  completed: { label: '完成', color: chartColors.teal },
  failed: { label: '失败', color: chartColors.coral },
} satisfies ChartConfig;

export const statusChartConfig = {
  completed: { label: '完成', color: chartColors.mint },
  failed: { label: '失败', color: chartColors.coral },
  running: { label: '运行中', color: '#9b6c22' },
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
  completed: 'bg-[var(--state-success-bg)] text-[var(--success)]',
  failed: 'bg-[var(--state-error-bg)] text-[var(--error)]',
  running: 'bg-[var(--state-warning-bg)] text-[var(--warning)]',
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
  const isLightTone = tone === 'white' || tone === 'lime';
  const content = (
    <div className="flex min-h-24 items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="caption opacity-70">{label}</p>
        <p className="mt-2 font-display text-3xl tabular-nums">{value}</p>
        <p className="mt-1 truncate text-xs opacity-70">{hint}</p>
      </div>
      <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--r-sm)] border', isLightTone ? 'border-[var(--line-default)] bg-[var(--surface-card)] text-[var(--ink)]' : 'border-white/20 bg-white/20')}>
        <Icon size={18} />
      </span>
    </div>
  );

  if (tone === 'white') return <Card className="p-5">{content}</Card>;
  return (
    <ColorBlock tone={tone} className="p-5">
      {content}
    </ColorBlock>
  );
}

export function SectionTitle({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="flex items-end justify-between gap-3 border-b border-[var(--line-subtle)] pb-3">
      <h2 className="font-display text-xl leading-none text-[var(--ink)]">{title}</h2>
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
    <div className="rounded-[var(--r-sm)] border border-[var(--line-default)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-sm)]">
      <div className="flex items-center justify-between gap-3">
        <span className="caption text-[var(--muted)]">{label}</span>
        <Icon size={16} className="text-[var(--muted)]" />
      </div>
      <p className="mt-3 truncate text-sm font-semibold text-[var(--ink)]">{bucket?.label ?? '暂无'}</p>
      <p className="caption mt-1 text-[var(--muted)]">{bucket ? value(bucket) : '暂无数据'}</p>
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return <div className="flex h-56 items-center justify-center text-sm text-[var(--muted)]">{label}</div>;
}
