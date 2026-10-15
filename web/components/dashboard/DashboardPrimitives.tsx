import type { ComponentType } from 'react';
import type { ChartConfig } from '../chart';
import { Card, ColorBlock } from '../ui/surface';
import type { DashboardBucket, RecentItem } from '../../hooks/useDashboardData';

type IconComponent = ComponentType<{ size?: number; className?: string }>;

/** 图表序列取自主题色板，避免为看板单独维护一套颜色。 */
export const chartColors = {
  ink: 'var(--chart-1)',
  muted: 'var(--muted-foreground)',
  hairline: 'var(--border)',
  lime: 'var(--chart-3)',
  mint: 'var(--chart-2)',
  coral: 'var(--destructive)',
  teal: 'var(--chart-2)',
  lilac: 'var(--chart-5)',
};

export const trendChartConfig = {
  total: { label: '会话', color: chartColors.ink },
  completed: { label: '完成', color: chartColors.teal },
  failed: { label: '失败', color: chartColors.coral },
} satisfies ChartConfig;

export const statusChartConfig = {
  completed: { label: '完成', color: chartColors.mint },
  failed: { label: '失败', color: chartColors.coral },
  running: { label: '运行中', color: 'var(--chart-4)' },
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
  completed: 'bg-success/10 text-success-foreground',
  failed: 'bg-destructive/10 text-destructive',
  running: 'bg-warning/10 text-warning-foreground',
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
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>
      </div>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background text-primary">
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
    <div className="flex items-end justify-between gap-3 border-b pb-3">
      <h2 className="text-lg font-semibold leading-none">{title}</h2>
      {meta ? <span className="text-xs text-muted-foreground">{meta}</span> : null}
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
    <div className="rounded-lg bg-muted/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon size={16} className="text-muted-foreground" />
      </div>
      <p className="mt-3 truncate text-sm font-medium">{bucket?.label ?? '暂无'}</p>
      <p className="mt-1 text-xs text-muted-foreground">{bucket ? value(bucket) : '暂无数据'}</p>
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">{label}</div>;
}
