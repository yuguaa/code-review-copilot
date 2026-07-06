import { lazy, Suspense } from 'react';
import type { DashboardChartBucket, DashboardData, DashboardStatusChartItem } from '../../hooks/useDashboardData';
import { FailureSamples, RecentActivity } from './ActivityLists';
import { AuthorDetailsTable, PeopleSignalGrid } from './PeopleInsights';
import { Card } from '../ui/surface';

const DashboardChartSections = lazy(() =>
  import('./DashboardChartSections').then((module) => ({ default: module.DashboardChartSections })),
);

type DashboardVisualSectionsProps = {
  data: DashboardData;
  statusChart: DashboardStatusChartItem[];
  authorChart: DashboardChartBucket[];
  repositoryChart: DashboardChartBucket[];
};

function ChartSectionsFallback() {
  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
        <Card className="h-80 animate-pulse bg-[var(--surface-soft)]">
          <div className="h-full" />
        </Card>
        <Card className="h-80 animate-pulse bg-[var(--surface-soft)]">
          <div className="h-full" />
        </Card>
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.28fr_0.72fr]">
        <Card className="h-80 animate-pulse bg-[var(--surface-soft)]">
          <div className="h-full" />
        </Card>
        <Card className="h-80 animate-pulse bg-[var(--surface-soft)]">
          <div className="h-full" />
        </Card>
      </div>
    </>
  );
}

export function DashboardVisualSections({ data, statusChart, authorChart, repositoryChart }: DashboardVisualSectionsProps) {
  return (
    <>
      <Suspense fallback={<ChartSectionsFallback />}>
        <DashboardChartSections
          authorChart={authorChart}
          failureRate={data.summary.failureRate}
          generatedAt={data.generatedAt}
          repositoryChart={repositoryChart}
          statusChart={statusChart}
          timeline={data.timeline}
        />
      </Suspense>

      <div className="grid gap-4 xl:grid-cols-[0.72fr_1.28fr]">
        <PeopleSignalGrid peopleSignals={data.peopleSignals} />
        <AuthorDetailsTable authors={data.authors} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <FailureSamples failures={data.failures} />
        <RecentActivity recent={data.recent} />
      </div>
    </>
  );
}
