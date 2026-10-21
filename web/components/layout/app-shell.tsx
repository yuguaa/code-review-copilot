import { useEffect, useState } from 'react';
import { ActivityIcon, BlocksIcon, ChartNoAxesCombinedIcon, ClipboardListIcon, FolderGit2Icon, HistoryIcon, LogOutIcon, MenuIcon, MessageSquarePlusIcon, RssIcon, ScanSearchIcon, Settings2Icon, ShieldCheckIcon, TargetIcon } from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '@web/App';
import { ResourceState } from '@web/components/common/resource-state';
import { Button } from '@web/components/ui/button';
import { Field, Select } from '@web/components/ui/forms';
import { Modal } from '@web/components/ui/modal';
import { ScrollArea } from '@web/components/ui/scroll-area';
import { Sheet, SheetContent, SheetTitle } from '@web/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@web/components/ui/tooltip';
import { useAction, useResource } from '@web/hooks/use-resource';
import { api } from '@web/lib/api';
import { activeRunStatuses, runDate, runStatusLabels, runTitle } from '@web/lib/run-format';
import { cn } from '@web/lib/utils';

import type { RepositoryItem, ReviewRun, RunStatus } from '@web/lib/types';

const navigation = [
  { to: '/', label: 'Code Review', icon: ActivityIcon },
  { to: '/security', label: '安全测试', icon: ShieldCheckIcon },
  { to: '/repositories', label: '仓库', icon: FolderGit2Icon },
  { to: '/models', label: '模型', icon: BlocksIcon },
  { to: '/connections', label: '连接器', icon: Settings2Icon },
  { to: '/rss', label: 'RSS', icon: RssIcon },
];

function isCodeReviewPath(pathname: string) {
  return pathname === '/' || pathname.startsWith('/runs/') || pathname.startsWith('/c/');
}

function isSecurityPath(pathname: string) {
  return pathname === '/security' || pathname.startsWith('/security/');
}

function isNavigationActive(pathname: string, to: string) {
  return to === '/' ? isCodeReviewPath(pathname) : pathname === to || pathname.startsWith(`${to}/`);
}

function statusDotClass(status: RunStatus) {
  if (activeRunStatuses.has(status)) return 'animate-pulse bg-info';
  if (status === 'completed') return 'bg-success';
  if (status === 'failed' || status === 'interrupted') return 'bg-destructive';
  return 'bg-muted-foreground/50';
}

function reviewTime(value: string | null) {
  return value ? new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '尚未开始';
}

function ReviewHistoryList({ runs, loading, error, retry }: {
  runs: ReviewRun[];
  loading: boolean;
  error: string | null;
  retry: () => void;
}) {
  return <ScrollArea className="min-h-0 flex-1">
    <div className="p-2">
      <div className="flex items-center justify-between px-2 py-2">
        <span className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground">最近审查</span>
        <span className="text-[10px] text-muted-foreground">{runs.length}</span>
      </div>
      {loading ? <div className="flex flex-col gap-2 px-2 py-2" role="status" aria-label="正在加载审查历史">
        {[0, 1, 2].map((item) => <div key={item} className="h-12 animate-pulse rounded-md bg-muted" />)}
      </div> : error ? <div className="px-2 py-3">
        <p className="text-xs text-destructive">{error}</p>
        <Button variant="ghost" size="xs" className="mt-2" onClick={retry}>重新加载</Button>
      </div> : runs.length === 0 ? <p className="px-2 py-3 text-xs leading-6 text-muted-foreground">暂无审查记录。</p> : <div className="flex flex-col gap-0.5">
        {runs.map((run) => <NavLink
          key={run.id}
          to={`/runs/${run.id}`}
          title={`${runTitle(run)} · ${runStatusLabels[run.status]}`}
          className={({ isActive }) => cn('flex items-start gap-2 rounded-md px-2 py-2 text-xs transition-colors hover:bg-sidebar-accent', isActive && 'bg-sidebar-accent text-sidebar-accent-foreground')}
        >
          <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', statusDotClass(run.status))} aria-label={runStatusLabels[run.status]} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{runTitle(run)}</span>
            <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="truncate">{run.repository?.path ?? '未关联仓库'}</span>
              <span>·</span>
              <time dateTime={runDate(run) ?? undefined}>{reviewTime(runDate(run))}</time>
            </span>
          </span>
        </NavLink>)}
      </div>}
    </div>
  </ScrollArea>;
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [repositoryId, setRepositoryId] = useState('');
  const location = useLocation();
  const codeReview = isCodeReviewPath(location.pathname);
  const security = isSecurityPath(location.pathname);
  const securityTicketsActive = location.pathname === '/security' || location.pathname.startsWith('/security/tickets/');
  const securityTargetsActive = location.pathname === '/security/targets';
  const history = useResource<{ runs: ReviewRun[]; total: number }>(codeReview ? '/api/runs?page=1' : null);
  const repositories = useResource<{ repositories: RepositoryItem[] }>(createOpen ? '/api/repositories' : null);
  const action = useAction();
  const auth = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!codeReview) return;
    const events = new EventSource('/api/sessions/events');
    const reload = () => { void history.reload(); };
    events.addEventListener('changed', reload);
    events.addEventListener('open', reload);
    return () => events.close();
  }, [codeReview, history.reload]);
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  const currentNavigation = navigation.find(({ to }) => isNavigationActive(location.pathname, to)) ?? navigation[0];
  const currentPage = codeReview
    ? (location.pathname === '/' ? 'Review 历史记录' : '审查详情')
    : security
      ? (location.pathname === '/security/targets' ? '测试目标' : location.pathname.startsWith('/security/tickets/') ? '工单详情' : '工单')
      : null;
  const logout = () => action.execute('logout', () => api('/api/auth/logout', { method: 'POST' }).then(auth.refresh).then(() => navigate('/login', { replace: true })));
  const historyCount = history.data?.total ?? 0;
  const historyMenu = <>
    <div className="border-b border-border/70 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">Workspace</p>
          <NavLink to="/" className="mt-2 flex min-w-0 items-center gap-2 text-sm font-semibold tracking-[-0.01em]">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground">
              <HistoryIcon className="size-3.5" />
            </span>
            <span className="truncate">Review 历史记录</span>
          </NavLink>
        </div>
        <span className="rounded-sm border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">{historyCount}</span>
      </div>
    </div>
    <ReviewHistoryList
      runs={history.data?.runs ?? []}
      loading={history.loading && !history.data}
      error={history.error}
      retry={() => { void history.reload(); }}
    />
  </>;
  const securityMenu = <>
    <div className="border-b border-border/70 px-4 py-4">
      <p className="text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">Workspace</p>
      <div className="mt-2 flex items-center gap-2 text-sm font-semibold tracking-[-0.01em]">
        <span className="flex size-7 items-center justify-center rounded-md border border-border bg-background">
          <ShieldCheckIcon className="size-3.5" />
        </span>
        安全测试
      </div>
    </div>
    <div className="flex flex-col gap-1 p-3">
      <p className="px-2 pb-1 text-[10px] font-medium tracking-[0.16em] text-muted-foreground uppercase">测试流程</p>
      <NavLink to="/security" className={cn(
        'flex items-center gap-2 rounded-md border px-2.5 py-2 text-sm transition-colors',
        securityTicketsActive ? 'border-border bg-sidebar-accent text-sidebar-accent-foreground' : 'border-transparent hover:bg-sidebar-accent',
      )}>
        <ClipboardListIcon className="size-4" />安全测试工单
      </NavLink>
      <NavLink to="/security/targets" className={cn(
        'flex items-center gap-2 rounded-md border px-2.5 py-2 text-sm transition-colors',
        securityTargetsActive ? 'border-border bg-sidebar-accent text-sidebar-accent-foreground' : 'border-transparent hover:bg-sidebar-accent',
      )}>
        <TargetIcon className="size-4" />测试目标
      </NavLink>
    </div>
  </>;

  return <TooltipProvider>
    <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:bg-background focus:p-3">跳转到主要内容</a>
    <div className="flex h-dvh overflow-hidden bg-sidebar">
      <nav className="hidden w-[68px] shrink-0 flex-col items-center gap-1 border-r border-border/70 bg-sidebar px-2 py-3 md:flex" aria-label="一级导航">
        <NavLink to="/" aria-label="Review Copilot 首页" className="mb-2 flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5">
          <ScanSearchIcon className="size-4.5" />
        </NavLink>
        <div className="mb-2 h-px w-8 bg-border" />
        {navigation.map(({ to, label, icon: Icon }) => {
          const active = isNavigationActive(location.pathname, to);
          return <Tooltip key={to}>
            <TooltipTrigger render={<NavLink to={to} end={to !== '/'} aria-label={label} aria-current={active ? 'page' : undefined} className={cn('flex size-9 items-center justify-center rounded-md border transition-colors', active ? 'border-border bg-sidebar-accent text-sidebar-accent-foreground' : 'border-transparent text-muted-foreground hover:bg-sidebar-accent hover:text-foreground')} />}>
              <Icon className="size-4.5" />
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>;
        })}
        <span className="flex-1" />
        {!security && <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-lg" aria-label="新建仓库对话" onClick={() => setCreateOpen(true)} />}>
            <MessageSquarePlusIcon className="size-4.5" />
          </TooltipTrigger>
          <TooltipContent side="right">新建仓库对话</TooltipContent>
        </Tooltip>}
        <Tooltip>
          <TooltipTrigger render={<a href="/observability/" aria-label="遥测" className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground" />}>
            <ChartNoAxesCombinedIcon className="size-4.5" />
          </TooltipTrigger>
          <TooltipContent side="right">遥测</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-lg" aria-label="退出登录" disabled={Boolean(action.pending)} onClick={logout} />}>
            <LogOutIcon className="size-4.5" />
          </TooltipTrigger>
          <TooltipContent side="right">退出登录</TooltipContent>
        </Tooltip>
      </nav>
      {codeReview && <aside className="hidden w-[248px] shrink-0 flex-col border-r border-border/70 bg-sidebar/65 md:flex" aria-label="Review 历史记录">{historyMenu}</aside>}
      {security && <aside className="hidden w-[248px] shrink-0 border-r border-border/70 bg-sidebar/65 p-0 md:block" aria-label="安全测试导航">{securityMenu}</aside>}
      <div className="app-grid flex min-w-0 flex-1 flex-col overflow-hidden bg-background md:m-2 md:ml-0 md:rounded-lg md:border md:border-border/80 md:shadow-sm">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border/70 bg-background/80 px-4 backdrop-blur-sm md:hidden">
          <Button variant="ghost" size="icon-xs" className="md:hidden" aria-label="打开导航" onClick={() => setMobileOpen(true)}><MenuIcon /></Button>
          <span className="text-[10px] font-medium tracking-[0.16em] text-muted-foreground uppercase">{currentNavigation.label}</span>
          {currentPage && <><span className="text-border">/</span><span className="truncate text-xs text-muted-foreground">{currentPage}</span></>}
          <span className="flex-1" />
          {!security && <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}><MessageSquarePlusIcon />新建对话</Button>}
        </div>
        <main id="main-content" className="flex min-h-0 min-w-0 flex-1 flex-col"><Outlet /></main>
      </div>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="flex w-72 flex-col gap-0 bg-sidebar p-0">
          <SheetTitle className="sr-only">工作空间导航</SheetTitle>
          <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border/70 px-4">
            <span className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground"><ScanSearchIcon className="size-4" /></span>
            <span className="text-sm font-semibold tracking-[-0.01em]">Review Copilot</span>
          </div>
          <nav className="flex flex-col gap-1 border-b border-border/70 p-3" aria-label="移动端一级导航">
            <span className="px-2 pb-1 text-[10px] font-medium tracking-[0.16em] text-muted-foreground uppercase">Workspace</span>
            {navigation.map(({ to, label, icon: Icon }) => {
              const active = isNavigationActive(location.pathname, to);
              return <NavLink key={to} to={to} end={to !== '/'} aria-current={active ? 'page' : undefined} className={cn('flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-sm transition-colors', active ? 'border-border bg-sidebar-accent text-sidebar-accent-foreground' : 'border-transparent hover:bg-sidebar-accent')}>
                <Icon className="size-4" />{label}
              </NavLink>;
            })}
          </nav>
          {codeReview && <div className="flex min-h-0 flex-1 flex-col">{historyMenu}</div>}
          {security && <div className="border-b">{securityMenu}</div>}
          <div className="mt-auto flex gap-2 border-t border-border/70 p-3">
            <Button variant="outline" size="sm" className="flex-1" render={<a href="/observability/" />}><ChartNoAxesCombinedIcon />遥测</Button>
            <Button variant="ghost" size="sm" className="flex-1" disabled={Boolean(action.pending)} onClick={logout}><LogOutIcon />退出登录</Button>
          </div>
        </SheetContent>
      </Sheet>
      <Modal open={createOpen} onClose={() => !action.pending && setCreateOpen(false)} title="新建仓库对话" maxWidth="sm:max-w-md">
        <p className="text-sm text-muted-foreground">选择仓库后，可以围绕代码和审查结果提问。</p>
        <ResourceState loading={repositories.loading} error={repositories.error} retry={repositories.reload} />
        {repositories.data && <form onSubmit={(event) => {
          event.preventDefault();
          action.execute('create', () => api<{ session: { id: string } }>('/api/sessions', { method: 'POST', body: JSON.stringify({ repositoryId }) }).then(({ session }) => {
            setCreateOpen(false);
            setRepositoryId('');
            navigate(`/c/${session.id}`);
          }));
        }} className="flex flex-col gap-5">
          <Field label="仓库"><Select value={repositoryId} required onChange={(event) => setRepositoryId(event.target.value)}><option value="">请选择仓库</option>{repositories.data.repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.path}</option>)}</Select></Field>
          <Button type="submit" disabled={!repositoryId || Boolean(action.pending)}>开始对话</Button>
        </form>}
      </Modal>
    </div>
  </TooltipProvider>;
}
