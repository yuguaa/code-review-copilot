import { BarChart3, CheckCircle2, UsersRound, Wrench } from 'lucide-react';
import type { DashboardSummary } from '../../hooks/useDashboardData';
import { MetricCard } from './DashboardPrimitives';

export function SummaryMetrics({ summary, windowDays }: { summary: DashboardSummary; windowDays: number }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="会话总量" value={summary.total} hint={`${windowDays} 天 · 审查 ${summary.reviewTotal} / 对话 ${summary.chatTotal}`} icon={BarChart3} tone="lime" />
      <MetricCard
        label="成功率"
        value={`${summary.successRate}%`}
        hint={`完成 ${summary.completed} · 失败 ${summary.failed} · 运行中 ${summary.running}`}
        icon={CheckCircle2}
        tone={summary.failureRate > 20 ? 'coral' : 'white'}
      />
      <MetricCard label="人员覆盖" value={summary.authorCount} hint={`活跃人员 · 平均消息 ${summary.avgMessagesPerSession}`} icon={UsersRound} />
      <MetricCard label="能力配置" value={`${summary.toolCount}/${summary.skillCount}`} hint={`Tools / Skills · 仓库 ${summary.activeRepositoryCount}/${summary.repositoryCount}`} icon={Wrench} tone="navy" />
    </div>
  );
}
