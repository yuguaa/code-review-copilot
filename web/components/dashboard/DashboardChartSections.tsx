import type { DashboardBucket, DashboardChartBucket, DashboardStatusChartItem } from '../../hooks/useDashboardData';
import { AuthorRiskChartCard, RepositoryHeatChartCard, StatusChartCard, TrendChartCard } from './DashboardCharts';

type DashboardChartSectionsProps = {
  authorChart: DashboardChartBucket[];
  failureRate: number;
  generatedAt: string;
  repositoryChart: DashboardChartBucket[];
  statusChart: DashboardStatusChartItem[];
  timeline: DashboardBucket[];
};

export function DashboardChartSections({
  authorChart,
  failureRate,
  generatedAt,
  repositoryChart,
  statusChart,
  timeline,
}: DashboardChartSectionsProps) {
  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
        <TrendChartCard timeline={timeline} generatedAt={generatedAt} />
        <StatusChartCard statusChart={statusChart} failureRate={failureRate} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.28fr_0.72fr]">
        <AuthorRiskChartCard authorChart={authorChart} />
        <RepositoryHeatChartCard repositoryChart={repositoryChart} />
      </div>
    </>
  );
}
