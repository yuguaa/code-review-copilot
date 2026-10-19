import { useEffect, useState } from 'react';
import { ActivityIcon, BlocksIcon, ChartNoAxesCombinedIcon, FolderGit2Icon, LogOutIcon, MenuIcon, MessageSquareIcon, PlusIcon, RssIcon, Settings2Icon } from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '@web/App';
import { ResourceState } from '@web/components/common/resource-state';
import { Button } from '@web/components/ui/button';
import { Field, Select } from '@web/components/ui/forms';
import { Modal } from '@web/components/ui/modal';
import { Sheet, SheetContent, SheetTitle } from '@web/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@web/components/ui/tooltip';
import { useAction, useResource } from '@web/hooks/use-resource';
import { api } from '@web/lib/api';
import { cn } from '@web/lib/utils';

import type { RepositoryItem, SessionListItem } from '@web/lib/types';

const navigation = [
  { to: '/', label: '活动', icon: ActivityIcon },
  { to: '/repositories', label: '仓库', icon: FolderGit2Icon },
  { to: '/models', label: '模型', icon: BlocksIcon },
  { to: '/connections', label: '连接器', icon: Settings2Icon },
  { to: '/rss', label: 'RSS', icon: RssIcon },
];

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [repositoryId, setRepositoryId] = useState('');
  const sessions = useResource<{ sessions: SessionListItem[] }>('/api/sessions?kind=chat');
  const repositories = useResource<{ repositories: RepositoryItem[] }>(createOpen ? '/api/repositories' : null);
  const action = useAction();
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const events = new EventSource('/api/sessions/events');
    const reload = () => { void sessions.reload(); };
    events.addEventListener('changed', reload);
    return () => events.close();
  }, [sessions.reload]);
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  const sidebar = <>
    <div className="flex h-14 shrink-0 items-center gap-2 border-b px-5"><span className="size-2 rounded-full bg-primary" /><span className="font-semibold">Review Copilot</span></div>
    <div className="flex flex-col gap-1 p-3">
      <p className="px-2 py-2 text-[10px] font-semibold tracking-[0.16em] text-muted-foreground">工作空间</p>
      {navigation.map(({ to, label, icon: Icon }) => <NavLink key={to} end={to === '/'} to={to} className={({ isActive }) => cn('flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-accent', isActive && 'bg-accent font-medium text-primary')}><Icon className="size-4" />{label}</NavLink>)}
      <a href="/observability/" className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-accent"><ChartNoAxesCombinedIcon className="size-4" />遥测</a>
    </div>
    <div className="flex items-center justify-between border-t px-5 py-3"><span className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground">最近对话</span><Button variant="ghost" size="icon-xs" aria-label="新建对话" onClick={() => setCreateOpen(true)}><PlusIcon /></Button></div>
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"><ResourceState loading={sessions.loading && !sessions.data} error={sessions.error} retry={sessions.reload} />{sessions.data?.sessions.length === 0 && <p className="px-2 py-3 text-xs leading-6 text-muted-foreground">对话会显示在这里。</p>}{sessions.data?.sessions.map((session) => <NavLink key={session.id} to={`/c/${session.id}`} className={({ isActive }) => cn('mb-1 flex items-start gap-2 rounded-md p-2 text-xs hover:bg-accent', isActive && 'bg-accent')}><MessageSquareIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0"><span className="block truncate">{session.title || '仓库对话'}</span><span className="mt-1 block truncate text-[11px] text-muted-foreground">{session.repository?.name ?? '对话'}</span></span></NavLink>)}</div>
    <div className="border-t p-3"><Button variant="ghost" className="w-full justify-start" disabled={Boolean(action.pending)} onClick={() => action.execute('logout', () => api('/api/auth/logout', { method: 'POST' }).then(auth.refresh).then(() => navigate('/login', { replace: true })))}><LogOutIcon />退出登录</Button></div>
  </>;

  return <TooltipProvider><a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:bg-background focus:p-3">跳转到主要内容</a><div className="flex h-dvh overflow-hidden bg-sidebar">
    <nav className="hidden w-16 shrink-0 flex-col items-center gap-3 border-r py-4 md:flex" aria-label="快捷导航"><NavLink to="/" className="mb-3 flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground" aria-label="Review Copilot 首页"><ActivityIcon className="size-5" /></NavLink>{navigation.map(({ to, label, icon: Icon }) => <Tooltip key={to}><TooltipTrigger render={<NavLink end={to === '/'} to={to} aria-label={label} className={({ isActive }) => cn('flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground', isActive && 'bg-accent text-primary')} />}><Icon className="size-4.5" /></TooltipTrigger><TooltipContent side="right">{label}</TooltipContent></Tooltip>)}<span className="flex-1" /><a href="/observability/" aria-label="遥测" className="flex size-9 items-center justify-center rounded-lg hover:bg-accent"><ChartNoAxesCombinedIcon className="size-4.5" /></a></nav>
    <aside className="hidden w-56 shrink-0 flex-col border-r lg:flex" aria-label="工作空间导航">{sidebar}</aside>
    <div className="flex min-w-0 flex-1 flex-col bg-background md:m-2 md:ml-0 md:rounded-xl md:border">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b px-4"><Button variant="ghost" size="icon-xs" className="lg:hidden" aria-label="打开导航" onClick={() => setMobileOpen(true)}><MenuIcon /></Button><span className="text-xs text-muted-foreground">工作空间</span><span className="text-border">/</span><span className="truncate text-xs font-medium">{navigation.find((item) => item.to !== '/' && location.pathname.startsWith(item.to))?.label ?? (location.pathname.startsWith('/c/') || location.pathname.startsWith('/runs/') ? '审查详情' : '活动')}</span><span className="flex-1" /><Button variant="ghost" size="sm" onClick={() => setCreateOpen(true)}><PlusIcon />新建对话</Button></div>
      <main id="main-content" className="flex min-h-0 min-w-0 flex-1 flex-col"><Outlet /></main>
    </div>
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}><SheetContent side="left" className="flex w-72 flex-col gap-0 p-0"><SheetTitle className="sr-only">工作空间导航</SheetTitle>{sidebar}</SheetContent></Sheet>
    <Modal open={createOpen} onClose={() => !action.pending && setCreateOpen(false)} title="新建仓库对话" maxWidth="sm:max-w-md"><p className="text-sm text-muted-foreground">选择仓库后，可以围绕代码和审查结果提问。</p><ResourceState loading={repositories.loading} error={repositories.error} retry={repositories.reload} />{repositories.data && <form onSubmit={(event) => { event.preventDefault(); action.execute('create', () => api<{ session: { id: string } }>('/api/sessions', { method: 'POST', body: JSON.stringify({ repositoryId }) }).then(({ session }) => { setCreateOpen(false); setRepositoryId(''); void sessions.reload(); navigate(`/c/${session.id}`); })); }} className="flex flex-col gap-5"><Field label="仓库"><Select value={repositoryId} required onChange={(event) => setRepositoryId(event.target.value)}><option value="">请选择仓库</option>{repositories.data.repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.path}</option>)}</Select></Field><Button type="submit" disabled={!repositoryId || Boolean(action.pending)}>开始对话</Button></form>}</Modal>
  </div></TooltipProvider>;
}
