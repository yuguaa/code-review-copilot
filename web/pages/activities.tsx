import { useEffect, useState } from 'react';
import { ArrowUpRightIcon, GitCommitHorizontalIcon, RefreshCwIcon, SearchIcon } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

import { ResourceState } from '@web/components/common/resource-state';
import { RunStatusBadge } from '@web/components/common/run-status';
import { ShellHeader } from '@web/components/layout/shell-header';
import { Timeline, TimelineIndicator, TimelineItem, TimelineSeparator } from '@web/components/neui/timeline';
import { Badge } from '@web/components/ui/badge';
import { Button } from '@web/components/ui/button';
import { Input, Select } from '@web/components/ui/forms';
import { useResource } from '@web/hooks/use-resource';
import { formatDate, runDate, runStatusLabels, runTitle } from '@web/lib/run-format';
import { NewReviewDialog } from "@web/components/review/new-review-dialog";

import type { RepositoryItem, ReviewRun } from '@web/lib/types';

function dayGroup(value: string | null) {
  if (!value) return '等待执行';
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return '今天';
  if (date.toDateString() === yesterday.toDateString()) return '昨天';
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

function ActivityEntry({ run, repository }: { run: ReviewRun; repository?: RepositoryItem }) {
  return <Link to={`/runs/${run.id}`} className="group flex flex-wrap items-start gap-3 rounded-md border border-border/70 bg-card px-3.5 py-3 transition-colors hover:border-border hover:bg-muted/25">
    <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background"><GitCommitHorizontalIcon className="size-3.5 text-muted-foreground" /></span>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium">{runTitle(run)}</h3><RunStatusBadge status={run.status} /></div>
      <p className="mt-1 truncate text-xs text-muted-foreground">{run.repository?.path ?? repository?.path ?? '仓库未关联'}<span className="mx-2">·</span>{run.triggerType}<span className="mx-2">·</span>{run.headSha?.slice(0, 8) ?? '等待确定提交'}</p>
      {run.error && <p className="mt-3 line-clamp-2 text-xs text-destructive">{run.error}</p>}
      <p className="mt-2 text-[11px] text-muted-foreground">{run.engineKey} {run.engineVersion}<span className="mx-2">·</span>{run.modelId ?? '模型待确定'}</p>
    </div>
    <div className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground"><time dateTime={runDate(run) ?? undefined}>{formatDate(runDate(run))}</time><ArrowUpRightIcon className="size-4 opacity-0 transition-opacity group-hover:opacity-100" /></div>
  </Link>;
}

export function Activities() {
  const [createOpen, setCreateOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const repositoryId = params.get('repository') ?? '';
  const status = params.get('status') ?? '';
  const trigger = params.get('trigger') ?? '';
  const dateFrom = params.get('from') ?? '';
  const query = new URLSearchParams();
  query.set("page", params.get("page") || "1");
  if (search) query.set("search", search);
  if (trigger) query.set("triggerType", trigger);
  if (dateFrom) {
    const selectedDate = new Date(`${dateFrom}T00:00:00`);
    query.set("from", Number.isFinite(selectedDate.getTime()) ? selectedDate.toISOString() : dateFrom);
  }
  if (repositoryId) query.set('repositoryId', repositoryId);
  if (status) query.set('status', status);
  const resource = useResource<{ runs: ReviewRun[]; total: number }>(`/api/runs?${query}`);
  const repositories = useResource<{ repositories: RepositoryItem[] }>('/api/repositories');
  const update = (key: string, value: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    value ? next.set(key, value) : next.delete(key);
    next.delete('page');
    return next;
  }, { replace: true });

  useEffect(() => {
    const events = new EventSource('/api/sessions/events');
    const reload = () => { void resource.reload(); };
    events.addEventListener('changed', reload);
    events.addEventListener('open', reload);
    return () => events.close();
  }, [resource.reload]);

  const filtered = resource.data?.runs ?? [];
  const pageCount = Math.max(1, Math.ceil((resource.data?.total ?? 0) / 20));
  const requestedPage = Number(params.get('page'));
  const page = Number.isInteger(requestedPage) ? Math.min(Math.max(1, requestedPage), pageCount) : 1;
  const groups = new Map<string, ReviewRun[]>();
  for (const run of filtered) {
    const label = dayGroup(runDate(run));
    const group = groups.get(label);
    if (group) group.push(run);
    else groups.set(label, [run]);
  }
  const changePage = (value: number) => setParams((current) => { const next = new URLSearchParams(current); next.set('page', String(value)); return next; });

  return <>
    {createOpen && repositories.data && <NewReviewDialog repositories={repositories.data.repositories} close={() => setCreateOpen(false)} />}
    <ShellHeader title="Review 历史记录" meta="按时间查看代码变更与审查运行"><Button disabled={!repositories.data} onClick={() => setCreateOpen(true)}>新建审查</Button><Button variant="outline" disabled={resource.loading} onClick={() => { void resource.reload(); }}><RefreshCwIcon className={resource.loading ? 'animate-spin' : ''} />刷新</Button></ShellHeader>
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-wrap items-center gap-3 border-b border-border/70 bg-background/55 px-4 py-3 sm:px-6">
        <div className="relative min-w-44 flex-1"><SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" /><Input aria-label="搜索审查运行" placeholder="搜索标题、仓库、提交…" className="pl-8" value={search} onChange={(event) => update('search', event.target.value)} /></div>
        <Select aria-label="筛选仓库" className="w-auto max-w-48" value={repositoryId} onChange={(event) => update('repository', event.target.value)}><option value="">全部仓库</option>{repositories.data?.repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</Select>
        <Select aria-label="筛选状态" className="w-auto" value={status} onChange={(event) => update('status', event.target.value)}><option value="">全部状态</option>{Object.entries(runStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select>
        <Select aria-label="筛选触发来源" className="w-auto" value={trigger} onChange={(event) => update('trigger', event.target.value)}><option value="">全部来源</option>{[...new Set(resource.data?.runs.map((run) => run.triggerType))].map((value) => <option key={value}>{value}</option>)}</Select>
        <Input type="date" aria-label="开始日期" className="w-auto" value={dateFrom} onChange={(event) => update('from', event.target.value)} />
      </div>
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex items-center justify-between"><h2 className="text-xl font-semibold tracking-[-0.03em]">审查时间线</h2><span className="text-xs text-muted-foreground">{resource.data?.total ?? 0} 条运行记录</span></div>
        <ResourceState loading={resource.loading && !resource.data} error={resource.error || repositories.error} empty={Boolean(resource.data && filtered.length === 0)} title={params.size ? '没有符合条件的运行' : '还没有审查运行'} description={params.size ? '调整筛选条件查看其他记录。' : '仓库接收到 GitLab Webhook 后，审查进度与报告会显示在这里。'} retry={() => { void resource.reload(); void repositories.reload(); }} />
        {!resource.error && [...groups].map(([label, runs]) => <section key={label} className="mb-8">
          <div className="mb-3 flex items-center gap-2"><h2 className="text-[10px] font-medium tracking-[0.16em] text-muted-foreground uppercase">{label}</h2><Badge variant="secondary">{runs.length}</Badge></div>
          <Timeline value={runs.length}>{runs.map((run, index) => <TimelineItem key={run.id} step={index + 1}><TimelineSeparator /><TimelineIndicator className="top-5 bg-background" /><ActivityEntry run={run} repository={repositories.data?.repositories.find((repo) => repo.id === run.repositoryId)} /></TimelineItem>)}</Timeline>
        </section>)}
        {pageCount > 1 && <nav aria-label="活动分页" className="flex items-center justify-end gap-3 border-t pt-4"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => changePage(page - 1)}>上一页</Button><span className="text-xs text-muted-foreground">{page} / {pageCount}</span><Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => changePage(page + 1)}>下一页</Button></nav>}
      </div>
    </div>
  </>;
}
