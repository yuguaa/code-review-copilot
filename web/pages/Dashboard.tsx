import { DashboardVisualSections } from '../components/dashboard/DashboardVisualSections';
import { SummaryMetrics } from '../components/dashboard/SummaryMetrics';
import { PageShell } from '../components/ui/page-shell';
import { useDashboardData } from '../hooks/useDashboardData';

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
        <SummaryMetrics summary={summary} windowDays={data.window.days} />
        <DashboardVisualSections data={data} statusChart={statusChart} authorChart={authorChart} repositoryChart={repositoryChart} />
      </div>
    </PageShell>
  );
}
