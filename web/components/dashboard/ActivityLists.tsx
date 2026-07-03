import { Link } from 'react-router-dom';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check';
import Clock3 from 'lucide-react/dist/esm/icons/clock-3';
import GitBranch from 'lucide-react/dist/esm/icons/git-branch';
import { cn } from '../../lib/cn';
import { dashboardStatusText, type FailureItem, type RecentItem } from '../../hooks/useDashboardData';
import { Card } from '../ui/surface';
import { branchText, fmtTime, SectionTitle, statusColor } from './DashboardPrimitives';

export function FailureSamples({ failures }: { failures: FailureItem[] }) {
  return (
    <Card className="space-y-4">
      <SectionTitle title="失败样本" meta="最近 8 条" />
      <div className="space-y-3">
        {failures.map((failure) => (
          <Link key={failure.id} to={`/c/${failure.id}`} className="dashboard-list-item block rounded-[var(--r-md)] bg-[var(--brand-coral)]/8 px-3 py-3 transition-[background-color,transform] hover:bg-[var(--brand-coral)]/12 active:scale-[0.99]">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--brand-coral)]">
              <AlertCircle size={15} />
              <span className="min-w-0 flex-1 truncate">{failure.title}</span>
            </div>
            <p className="mt-1 max-h-[2.75rem] overflow-hidden text-xs leading-relaxed text-[var(--body)]">{failure.error}</p>
            <p className="caption mt-2 truncate text-[var(--muted)]">
              {failure.author} · {failure.repository} · {fmtTime(failure.updatedAt)}
            </p>
          </Link>
        ))}
        {failures.length === 0 && <p className="text-sm text-[var(--muted)]">暂无失败样本</p>}
      </div>
    </Card>
  );
}

export function RecentActivity({ recent }: { recent: RecentItem[] }) {
  return (
    <Card className="space-y-4">
      <SectionTitle title="最近活动" meta="最新 12 条会话" />
      <div className="divide-y divide-[var(--hairline)]">
        {recent.map((item) => (
          <Link key={item.id} to={`/c/${item.id}`} className="dashboard-list-item grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 py-3 transition-[background-color,transform] hover:bg-[var(--surface-soft)] active:scale-[0.99] max-md:grid-cols-[auto_minmax(0,1fr)]">
            <span className={cn('mt-0.5 flex h-8 w-8 items-center justify-center rounded-[var(--r-pill)]', statusColor[item.status] ?? 'bg-[var(--surface-card)] text-[var(--muted)]')}>
              {item.status === 'failed' ? <AlertCircle size={15} /> : item.status === 'running' ? <Clock3 size={15} /> : <CheckCircle2 size={15} />}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-[var(--ink)]">{item.title}</span>
              <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-[var(--muted)]">
                <GitBranch size={11} className="shrink-0" />
                <span className="truncate">{branchText(item)}</span>
              </span>
              <span className="caption mt-1 block truncate text-[var(--muted)]">
                {item.author} · {item.repository}
              </span>
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
  );
}
