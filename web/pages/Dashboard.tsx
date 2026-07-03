import { Link } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Clock3,
  FolderGit2,
  GitBranch,
  MessageSquare,
  UserRound,
  UsersRound,
  Wrench,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '../lib/cn';
import { Card, ColorBlock, PageShell } from '../components/ui';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../components/chart';
import { dashboardStatusText, type DashboardBucket, type RecentItem, useDashboardData } from '../hooks/useDashboardData';

const chartColors = {
  ink: '#0a0a0a',
  muted: '#6f6f68',
  hairline: '#deded8',
  lime: '#d7ff38',
  mint: '#b8f3d3',
  coral: '#ff5f57',
  teal: '#0f3b35',
  lilac: '#c7b8ff',
};

const trendChartConfig = {
  total: { label: '会话', color: chartColors.ink },
  completed: { label: '完成', color: chartColors.teal },
  failed: { label: '失败', color: chartColors.coral },
} satisfies ChartConfig;

const statusChartConfig = {
  completed: { label: '完成', color: chartColors.mint },
  failed: { label: '失败', color: chartColors.coral },
  running: { label: '运行中', color: chartColors.lime },
} satisfies ChartConfig;

const authorChartConfig = {
  total: { label: '会话', color: chartColors.ink },
  failed: { label: '失败', color: chartColors.coral },
  avgMessagesPerSession: { label: '均消息', color: chartColors.lilac },
} satisfies ChartConfig;

const repositoryChartConfig = {
  total: { label: '会话', color: chartColors.teal },
} satisfies ChartConfig;

const statusColor: Record<string, string> = {
  completed: 'bg-[var(--brand-mint)] text-[var(--ink)]',
  failed: 'bg-[var(--brand-coral)] text-white',
  running: 'bg-[var(--brand-cream)] text-[var(--ink)]',
};

function fmtTime(value: string | null): string {
  if (!value) return '暂无';
  return new Date(value).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function branchText(item: RecentItem): string {
  if (item.sourceBranch && item.targetBranch) return `${item.sourceBranch} -> ${item.targetBranch}`;
  return item.sourceBranch ?? item.targetBranch ?? '未记录分支';
}

function chartHeight(items: unknown[], min = 280, row = 36): number {
  return Math.max(min, items.length * row);
}

function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'white',
}: {
  label: string;
  value: string | number;
  hint: string;
  icon: typeof Activity;
  tone?: 'white' | 'lime' | 'coral' | 'navy';
}) {
  const content = (
    <div className="flex min-h-28 items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="eyebrow opacity-70">{label}</p>
        <p className="mt-3 font-display text-3xl tabular-nums">{value}</p>
        <p className="mt-1 truncate text-xs opacity-70">{hint}</p>
      </div>
      <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--r-pill)]', tone === 'white' ? 'bg-[var(--surface-card)] text-[var(--ink)]' : 'bg-white/20')}>
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

function SectionTitle({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <h2 className="font-display text-lg text-[var(--ink)]">{title}</h2>
      {meta && <span className="caption text-[var(--muted)]">{meta}</span>}
    </div>
  );
}

function SignalCard({
  label,
  bucket,
  value,
  icon: Icon,
}: {
  label: string;
  bucket: DashboardBucket | null;
  value: (bucket: DashboardBucket) => string;
  icon: typeof Activity;
}) {
  return (
    <div className="rounded-[var(--r-md)] bg-[var(--surface-soft)] p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="eyebrow text-[var(--muted)]">{label}</span>
        <Icon size={16} className="text-[var(--muted)]" />
      </div>
      <p className="mt-3 truncate text-sm font-semibold text-[var(--ink)]">{bucket?.label ?? '暂无'}</p>
      <p className="caption mt-1 text-[var(--muted)]">{bucket ? value(bucket) : 'NO DATA'}</p>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="flex h-56 items-center justify-center text-sm text-[var(--muted)]">{label}</div>;
}

export function Dashboard() {
  const { data, statusChart, authorChart, repositoryChart } = useDashboardData();

  if (!data) {
    return (
      <PageShell title="数据看板" maxWidth="max-w-7xl">
        <div className="flex h-64 items-center justify-center text-sm text-[var(--muted)]">加载数据中…</div>
      </PageShell>
    );
  }

  const summary = data.summary;

  return (
    <PageShell title="数据看板" maxWidth="max-w-7xl">
      <div className="space-y-8">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="会话总量" value={summary.total} hint={`${data.window.days} 天 · 审查 ${summary.reviewTotal} / 对话 ${summary.chatTotal}`} icon={BarChart3} tone="lime" />
          <MetricCard label="成功率" value={`${summary.successRate}%`} hint={`完成 ${summary.completed} · 失败 ${summary.failed} · 运行中 ${summary.running}`} icon={CheckCircle2} tone={summary.failureRate > 20 ? 'coral' : 'white'} />
          <MetricCard label="人员覆盖" value={summary.authorCount} hint={`活跃人员 · 平均消息 ${summary.avgMessagesPerSession}`} icon={UsersRound} />
          <MetricCard label="能力配置" value={`${summary.toolCount}/${summary.skillCount}`} hint={`Tools / Skills · 仓库 ${summary.activeRepositoryCount}/${summary.repositoryCount}`} icon={Wrench} tone="navy" />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
          <Card className="space-y-5">
            <SectionTitle title="14 天趋势" meta={`生成于 ${fmtTime(data.generatedAt)}`} />
            {data.timeline.length === 0 ? (
              <EmptyState label="暂无趋势数据" />
            ) : (
              <ChartContainer config={trendChartConfig} className="h-80 w-full">
                <AreaChart data={data.timeline} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dashboardTotal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-total)" stopOpacity={0.8} />
                      <stop offset="100%" stopColor="var(--color-total)" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Area type="monotone" dataKey="total" stroke="var(--color-total)" strokeWidth={2} fill="url(#dashboardTotal)" />
                  <Line type="monotone" dataKey="completed" stroke="var(--color-completed)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="failed" stroke="var(--color-failed)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ChartContainer>
            )}
          </Card>

          <Card className="space-y-5">
            <SectionTitle title="状态结构" meta={`${summary.failureRate}% 失败率`} />
            {statusChart.length === 0 ? (
              <EmptyState label="暂无状态数据" />
            ) : (
              <ChartContainer config={statusChartConfig} className="h-80 w-full">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                  <Pie data={statusChart} dataKey="count" nameKey="name" innerRadius={62} outerRadius={98} paddingAngle={3}>
                    {statusChart.map((item) => (
                      <Cell
                        key={item.status}
                        fill={item.status === 'failed' ? 'var(--color-failed)' : item.status === 'completed' ? 'var(--color-completed)' : 'var(--color-running)'}
                      />
                    ))}
                  </Pie>
                  <ChartLegend content={<ChartLegendContent nameKey="name" />} />
                </PieChart>
              </ChartContainer>
            )}
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.72fr_1.28fr]">
          <Card className="space-y-4">
            <SectionTitle title="人员信号" meta="按作者维度计算" />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <SignalCard label="最活跃" bucket={data.peopleSignals.mostActive} icon={UserRound} value={(item) => `${item.total} 次 · 占比 ${item.activityShare}%`} />
              <SignalCard label="失败最多" bucket={data.peopleSignals.mostFailures} icon={AlertCircle} value={(item) => `${item.failed} 次失败 · 贡献 ${item.failureShare}%`} />
              <SignalCard label="覆盖最广" bucket={data.peopleSignals.widestCoverage} icon={FolderGit2} value={(item) => `${item.repositoryCount} 个仓库 · 主仓库 ${item.topRepository?.label ?? '暂无'}`} />
              <SignalCard label="消息密度最高" bucket={data.peopleSignals.highestMessageDensity} icon={MessageSquare} value={(item) => `${item.avgMessagesPerSession} 条/会话 · 总消息 ${item.messages}`} />
            </div>
          </Card>

          <Card className="space-y-5">
            <SectionTitle title="人员贡献与风险" meta="会话数 / 失败数 / 消息密度" />
            {authorChart.length === 0 ? (
              <EmptyState label="暂无人员数据" />
            ) : (
              <ChartContainer config={authorChartConfig} className="w-full" style={{ height: chartHeight(authorChart, 360, 42) }}>
                <BarChart data={authorChart} layout="vertical" margin={{ top: 4, right: 18, left: 26, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={86} tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="total" fill="var(--color-total)" radius={[0, 6, 6, 0]} />
                  <Bar dataKey="failed" fill="var(--color-failed)" radius={[0, 6, 6, 0]} />
                  <Bar dataKey="avgMessagesPerSession" fill="var(--color-avgMessagesPerSession)" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ChartContainer>
            )}
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <Card className="space-y-5">
            <SectionTitle title="人员明细" meta="用于定位高频触发者与风险集中点" />
            <div className="overflow-x-auto">
              <div className="min-w-[760px] divide-y divide-[var(--hairline)]">
                <div className="grid grid-cols-[2.1fr_0.7fr_0.7fr_0.8fr_0.8fr_1.4fr] gap-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                  <span>人员</span>
                  <span>会话</span>
                  <span>失败</span>
                  <span>成功率</span>
                  <span>仓库</span>
                  <span>主要仓库 / 最近</span>
                </div>
                {data.authors.map((author, index) => (
                  <div key={author.key} className="grid grid-cols-[2.1fr_0.7fr_0.7fr_0.8fr_0.8fr_1.4fr] items-center gap-3 py-3 text-sm">
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="caption w-6 shrink-0 text-[var(--muted)]">{String(index + 1).padStart(2, '0')}</span>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-pill)] bg-[var(--surface-card)] text-[var(--ink)]">
                        <UserRound size={14} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-[var(--ink)]">{author.label}</span>
                        <span className="caption text-[var(--muted)]">活跃占比 {author.activityShare}%</span>
                      </span>
                    </span>
                    <span className="tabular-nums text-[var(--ink)]">{author.total}</span>
                    <span className={cn('tabular-nums', author.failed > 0 ? 'font-semibold text-[var(--brand-coral)]' : 'text-[var(--body)]')}>{author.failed}</span>
                    <span className="tabular-nums text-[var(--body)]">{author.successRate}%</span>
                    <span className="tabular-nums text-[var(--body)]">{author.repositoryCount}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[var(--body-strong)]">{author.topRepository?.label ?? '暂无仓库'}</span>
                      <span className="caption text-[var(--muted)]">{fmtTime(author.latestAt)}</span>
                    </span>
                  </div>
                ))}
                {data.authors.length === 0 && <p className="py-10 text-center text-sm text-[var(--muted)]">暂无人员数据</p>}
              </div>
            </div>
          </Card>

          <Card className="space-y-5">
            <SectionTitle title="仓库热度" meta="按会话量排序" />
            {repositoryChart.length === 0 ? (
              <EmptyState label="暂无仓库数据" />
            ) : (
              <ChartContainer config={repositoryChartConfig} className="w-full" style={{ height: chartHeight(repositoryChart, 360, 38) }}>
                <BarChart data={repositoryChart} layout="vertical" margin={{ top: 4, right: 16, left: 68, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={126} tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="total" radius={[0, 6, 6, 0]}>
                    {repositoryChart.map((repo) => (
                      <Cell key={repo.key} fill={repo.failed > 0 ? chartColors.coral : 'var(--color-total)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            )}
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <Card className="space-y-4">
            <SectionTitle title="失败样本" meta="最近 8 条" />
            <div className="space-y-3">
              {data.failures.map((failure) => (
                <Link key={failure.id} to={`/c/${failure.id}`} className="block rounded-[var(--r-md)] bg-[var(--brand-coral)]/8 px-3 py-3 transition-[background-color,transform] hover:bg-[var(--brand-coral)]/12 active:scale-[0.99]">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[var(--brand-coral)]">
                    <AlertCircle size={15} />
                    <span className="min-w-0 flex-1 truncate">{failure.title}</span>
                  </div>
                  <p className="mt-1 max-h-[2.75rem] overflow-hidden text-xs leading-relaxed text-[var(--body)]">{failure.error}</p>
                  <p className="caption mt-2 truncate text-[var(--muted)]">{failure.author} · {failure.repository} · {fmtTime(failure.updatedAt)}</p>
                </Link>
              ))}
              {data.failures.length === 0 && <p className="text-sm text-[var(--muted)]">暂无失败样本</p>}
            </div>
          </Card>

          <Card className="space-y-4">
            <SectionTitle title="最近活动" meta="最新 12 条会话" />
            <div className="divide-y divide-[var(--hairline)]">
              {data.recent.map((item) => (
                <Link key={item.id} to={`/c/${item.id}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 py-3 transition-[background-color,transform] hover:bg-[var(--surface-soft)] active:scale-[0.99] max-md:grid-cols-[auto_minmax(0,1fr)]">
                  <span className={cn('mt-0.5 flex h-8 w-8 items-center justify-center rounded-[var(--r-pill)]', statusColor[item.status] ?? 'bg-[var(--surface-card)] text-[var(--muted)]')}>
                    {item.status === 'failed' ? <AlertCircle size={15} /> : item.status === 'running' ? <Clock3 size={15} /> : <CheckCircle2 size={15} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[var(--ink)]">{item.title}</span>
                    <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-[var(--muted)]">
                      <GitBranch size={11} className="shrink-0" />
                      <span className="truncate">{branchText(item)}</span>
                    </span>
                    <span className="caption mt-1 block truncate text-[var(--muted)]">{item.author} · {item.repository}</span>
                  </span>
                  <span className="text-right max-md:col-start-2 max-md:flex max-md:items-center max-md:gap-3 max-md:text-left">
                    <span className="caption block text-[var(--muted)]">{dashboardStatusText[item.status] ?? item.status}</span>
                    <span className="caption block text-[var(--muted-soft)]">{item.messages} MSG</span>
                    <span className="caption block text-[var(--muted-soft)]">{fmtTime(item.updatedAt)}</span>
                  </span>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
