import { Link } from 'react-router-dom';
import { AlertCircleIcon, CheckCircle2Icon, Clock3Icon, GitBranchIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { dashboardStatusText, type FailureItem, type RecentItem } from '../../hooks/useDashboardData';
import { Card } from '../ui/surface';
import { branchText, fmtTime, SectionTitle, statusColor } from './DashboardPrimitives';

export function FailureSamples({ failures }: { failures: FailureItem[] }) {
  return (
    <Card className="space-y-4">
      <SectionTitle title="失败样本" meta="最近 8 条" />
      <div className="space-y-3">
        {failures.map((failure) => (
          <Link
            key={failure.id}
            to={`/c/${failure.id}`}
            className="dashboard-list-item block rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-3 transition-colors hover:bg-destructive/10"
          >
            <div className="flex items-center gap-2 text-sm font-medium text-destructive">
              <AlertCircleIcon size={15} />
              <span className="min-w-0 flex-1 truncate">{failure.title}</span>
            </div>
            <p className="mt-1 max-h-[2.75rem] overflow-hidden text-xs leading-relaxed text-muted-foreground">
              {failure.error}
            </p>
            <p className="mt-2 truncate text-xs text-muted-foreground">
              {failure.author} · {failure.repository} · {fmtTime(failure.updatedAt)}
            </p>
          </Link>
        ))}
        {failures.length === 0 ? <p className="text-sm text-muted-foreground">暂无失败样本</p> : null}
      </div>
    </Card>
  );
}

export function RecentActivity({ recent }: { recent: RecentItem[] }) {
  return (
    <Card className="space-y-4">
      <SectionTitle title="最近活动" meta="最新 12 条会话" />
      <div className="divide-y">
        {recent.map((item) => (
          <Link
            key={item.id}
            to={`/c/${item.id}`}
            className="dashboard-list-item grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 py-3 transition-colors hover:bg-muted/50 max-md:grid-cols-[auto_minmax(0,1fr)]"
          >
            <span
              className={cn(
                'mt-0.5 flex size-8 items-center justify-center rounded-full border',
                statusColor[item.status] ?? 'bg-card text-muted-foreground',
              )}
            >
              {item.status === 'failed' ? (
                <AlertCircleIcon size={15} />
              ) : item.status === 'running' ? (
                <Clock3Icon size={15} />
              ) : (
                <CheckCircle2Icon size={15} />
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{item.title}</span>
              <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                <GitBranchIcon size={11} className="shrink-0" />
                <span className="truncate">{branchText(item)}</span>
              </span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                {item.author} · {item.repository}
              </span>
            </span>
            <span className="text-right max-md:col-start-2 max-md:flex max-md:items-center max-md:gap-3 max-md:text-left">
              <span className="block text-xs text-muted-foreground">
                {dashboardStatusText[item.status] ?? item.status}
              </span>
              <span className="block text-xs text-muted-foreground">{item.messages} 条消息</span>
              <span className="block text-xs text-muted-foreground">{fmtTime(item.updatedAt)}</span>
            </span>
          </Link>
        ))}
      </div>
    </Card>
  );
}
