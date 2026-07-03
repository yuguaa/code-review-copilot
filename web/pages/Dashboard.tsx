import { FailureSamples, RecentActivity } from '../components/dashboard/ActivityLists';
import { AuthorRiskChartCard, RepositoryHeatChartCard, StatusChartCard, TrendChartCard } from '../components/dashboard/DashboardCharts';
import { AuthorDetailsTable, PeopleSignalGrid } from '../components/dashboard/PeopleInsights';
import { SummaryMetrics } from '../components/dashboard/SummaryMetrics';
import { PageShell } from '../components/ui';
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

        <div className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
          <TrendChartCard timeline={data.timeline} generatedAt={data.generatedAt} />
          <StatusChartCard statusChart={statusChart} failureRate={summary.failureRate} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.72fr_1.28fr]">
          <PeopleSignalGrid peopleSignals={data.peopleSignals} />
          <AuthorRiskChartCard authorChart={authorChart} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <AuthorDetailsTable authors={data.authors} />
          <RepositoryHeatChartCard repositoryChart={repositoryChart} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <FailureSamples failures={data.failures} />
          <RecentActivity recent={data.recent} />
        </div>
      </div>
    </PageShell>
  );
}
