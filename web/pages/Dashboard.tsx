import { lazy, Suspense } from 'react';
import { SummaryMetrics } from '../components/dashboard/SummaryMetrics';
import { Card, PageShell } from '../components/ui';
import { useDashboardData } from '../hooks/useDashboardData';

const DashboardVisualSections = lazy(() =>
  import('../components/dashboard/DashboardVisualSections').then((module) => ({ default: module.DashboardVisualSections })),
);

function DashboardVisualFallback() {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <Card key={index} className="h-80 animate-pulse bg-[var(--surface-soft)]">
          <div className="h-full" />
        </Card>
      ))}
    </div>
  );
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
        <SummaryMetrics summary={summary} windowDays={data.window.days} />
        <Suspense fallback={<DashboardVisualFallback />}>
          <DashboardVisualSections data={data} statusChart={statusChart} authorChart={authorChart} repositoryChart={repositoryChart} />
        </Suspense>
      </div>
    </PageShell>
  );
}
