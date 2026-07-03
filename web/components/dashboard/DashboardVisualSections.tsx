import type { DashboardChartBucket, DashboardData, DashboardStatusChartItem } from '../../hooks/useDashboardData';
import { FailureSamples, RecentActivity } from './ActivityLists';
import { AuthorRiskChartCard, RepositoryHeatChartCard, StatusChartCard, TrendChartCard } from './DashboardCharts';
import { AuthorDetailsTable, PeopleSignalGrid } from './PeopleInsights';

type DashboardVisualSectionsProps = {
  data: DashboardData;
  statusChart: DashboardStatusChartItem[];
  authorChart: DashboardChartBucket[];
  repositoryChart: DashboardChartBucket[];
};

export function DashboardVisualSections({ data, statusChart, authorChart, repositoryChart }: DashboardVisualSectionsProps) {
  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
        <TrendChartCard timeline={data.timeline} generatedAt={data.generatedAt} />
        <StatusChartCard statusChart={statusChart} failureRate={data.summary.failureRate} />
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
    </>
  );
}
