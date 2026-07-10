import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert';
import FolderGit2 from 'lucide-react/dist/esm/icons/folder-git-2';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square';
import UserRound from 'lucide-react/dist/esm/icons/user-round';
import { cn } from '../../lib/cn';
import type { DashboardBucket, PeopleSignals } from '../../hooks/useDashboardData';
import { Card } from '../ui/surface';
import { fmtTime, SectionTitle, SignalCard } from './DashboardPrimitives';

export function PeopleSignalGrid({ peopleSignals }: { peopleSignals: PeopleSignals }) {
  return (
    <Card className="space-y-4">
      <SectionTitle title="人员信号" meta="按作者维度计算" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
        <SignalCard label="最活跃" bucket={peopleSignals.mostActive} icon={UserRound} value={(item) => `${item.total} 次 · 占比 ${item.activityShare}%`} />
        <SignalCard label="失败最多" bucket={peopleSignals.mostFailures} icon={AlertCircle} value={(item) => `${item.failed} 次失败 · 贡献 ${item.failureShare}%`} />
        <SignalCard label="覆盖最广" bucket={peopleSignals.widestCoverage} icon={FolderGit2} value={(item) => `${item.repositoryCount} 个仓库 · 主仓库 ${item.topRepository?.label ?? '暂无'}`} />
        <SignalCard label="消息密度最高" bucket={peopleSignals.highestMessageDensity} icon={MessageSquare} value={(item) => `${item.avgMessagesPerSession} 条/会话 · 总消息 ${item.messages}`} />
      </div>
    </Card>
  );
}

export function AuthorDetailsTable({ authors }: { authors: DashboardBucket[] }) {
  return (
    <Card className="space-y-5">
      <SectionTitle title="人员明细" meta="用于定位高频触发者与风险集中点" />
      <div className="overflow-x-auto">
        <div className="min-w-[760px] divide-y divide-[var(--line-subtle)]">
          <div className="grid grid-cols-[2.1fr_0.7fr_0.7fr_0.8fr_0.8fr_1.4fr] gap-3 pb-2 text-xs font-semibold text-[var(--muted)]">
            <span>人员</span>
            <span>会话</span>
            <span>失败</span>
            <span>成功率</span>
            <span>仓库</span>
            <span>主要仓库 / 最近</span>
          </div>
          {authors.map((author, index) => (
            <div key={author.key} className="dashboard-list-item grid grid-cols-[2.1fr_0.7fr_0.7fr_0.8fr_0.8fr_1.4fr] items-center gap-3 py-3 text-sm">
              <span className="flex min-w-0 items-center gap-3">
                <span className="caption w-6 shrink-0 text-[var(--muted)]">{String(index + 1).padStart(2, '0')}</span>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-pill)] border border-[var(--line-default)] bg-[var(--surface-card)] text-[var(--ink)]">
                  <UserRound size={14} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-[var(--ink)]">{author.label}</span>
                  <span className="caption text-[var(--muted)]">活跃占比 {author.activityShare}%</span>
                </span>
              </span>
              <span className="tabular-nums text-[var(--ink)]">{author.total}</span>
              <span className={cn('tabular-nums', author.failed > 0 ? 'font-semibold text-[var(--brand-coral)]' : 'text-[var(--body)]')}>{author.failed}</span>
              <span className="tabular-nums text-[var(--body)]">{author.successRate}%</span>
              <span className="tabular-nums text-[var(--body)]">{author.repositoryCount}</span>
              <span className="min-w-0">
                <span className="block truncate text-[var(--body-strong)]">{author.topRepository?.label ?? '暂无仓库'}</span>
                <span className="caption text-[var(--muted)]">{fmtTime(author.latestAt)}</span>
              </span>
            </div>
          ))}
          {authors.length === 0 && <p className="py-10 text-center text-sm text-[var(--muted)]">暂无人员数据</p>}
        </div>
      </div>
    </Card>
  );
}
