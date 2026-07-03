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
import type { DashboardBucket, DashboardChartBucket, DashboardStatusChartItem } from '../../hooks/useDashboardData';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '../chart';
import { Card } from '../ui/surface';
import {
  authorChartConfig,
  chartColors,
  chartHeight,
  EmptyState,
  fmtTime,
  repositoryChartConfig,
  SectionTitle,
  statusChartConfig,
  trendChartConfig,
} from './DashboardPrimitives';

export function TrendChartCard({ timeline, generatedAt }: { timeline: DashboardBucket[]; generatedAt: string }) {
  return (
    <Card className="space-y-5">
      <SectionTitle title="14 天趋势" meta={`生成于 ${fmtTime(generatedAt)}`} />
      {timeline.length === 0 ? (
        <EmptyState label="暂无趋势数据" />
      ) : (
        <ChartContainer config={trendChartConfig} className="h-80 w-full">
          <AreaChart data={timeline} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
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
  );
}

export function StatusChartCard({ statusChart, failureRate }: { statusChart: DashboardStatusChartItem[]; failureRate: number }) {
  return (
    <Card className="space-y-5">
      <SectionTitle title="状态结构" meta={`${failureRate}% 失败率`} />
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
  );
}

export function AuthorRiskChartCard({ authorChart }: { authorChart: DashboardChartBucket[] }) {
  return (
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
  );
}

export function RepositoryHeatChartCard({ repositoryChart }: { repositoryChart: DashboardChartBucket[] }) {
  return (
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
  );
}
