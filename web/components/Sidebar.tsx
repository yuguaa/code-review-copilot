import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  GitPullRequest,
  MessageSquare,
  Plus,
  Settings as SettingsIcon,
  FolderGit2,
  LogOut,
  Trash2,
  ChevronRight,
  ScanSearch,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import type { SessionListItem, RepositoryItem } from '../lib/types';

const statusColor: Record<string, string> = {
  running: 'bg-amber-400',
  completed: 'bg-emerald-400',
  failed: 'bg-rose-500',
};

const statusLabel: Record<string, string> = {
  running: '审查进行中',
  completed: '已完成',
  failed: '失败',
};

const NONE_KEY = '__none__';

type RepoGroup = {
  key: string;
  name: string;
  path: string | null;
  sessions: SessionListItem[];
};

/** 会话标题展示：审查会话带 MR 编号，普通对话空标题回退「新对话」。 */
function sessionLabel(s: SessionListItem): string {
  if (s.kind === 'review') {
    const prefix = s.mrIid ? `!${s.mrIid} ` : '';
    return `${prefix}${s.title || '代码审查'}`;
  }
  return s.title || '新对话';
}

/** 按仓库把会话聚成有序分组（沿用 updatedAt 倒序，最近活跃的仓库在前）。 */
function groupByRepo(sessions: SessionListItem[]): RepoGroup[] {
  const groups = new Map<string, RepoGroup>();
  for (const s of sessions) {
    const key = s.repository?.path ?? NONE_KEY;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        name: s.repository?.name || s.repository?.path?.split('/').pop() || '未关联仓库',
        path: s.repository?.path ?? null,
        sessions: [],
      };
      groups.set(key, group);
    }
    group.sessions.push(s);
  }
  return [...groups.values()];
}

export function Sidebar({ refreshKey }: { refreshKey?: number }) {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const navigate = useNavigate();
  const { sessionId } = useParams();

  const load = useCallback(async () => {
    const data = await api<{ sessions: SessionListItem[] }>('/api/sessions').catch(() => ({ sessions: [] }));
    setSessions(data.sessions);
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    const events = new EventSource('/api/sessions/events');
    events.addEventListener('changed', () => {
      void load();
    });
    return () => events.close();
  }, [load]);

  const groups = useMemo(() => groupByRepo(sessions), [sessions]);

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const newChat = async () => {
    const repos = await api<{ repositories: RepositoryItem[] }>('/api/repositories').catch(() => ({ repositories: [] }));
    if (repos.repositories.length === 0) {
      toast.error('请先在「仓库配置」添加一个仓库（含模型配置）');
      return;
    }
    const { session } = await api<{ session: { id: string } }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ repositoryId: repos.repositories[0].id }),
    });
    await load();
    navigate(`/c/${session.id}`);
  };

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.href = '/login';
  };

  const removeSession = (id: string) => {
    if (!window.confirm('确认删除这个会话吗？删除后无法在侧栏恢复。')) return;
    api(`/api/sessions/${id}`, { method: 'DELETE' })
      .then(load)
      .then(() => {
        if (id === sessionId) navigate('/');
        toast.success('已删除会话');
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : '删除失败'));
  };

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-slate-200/80 bg-white">
      <div className="flex items-center justify-between gap-2 px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm shadow-indigo-600/30">
            <ScanSearch size={16} />
          </span>
          <span className="truncate text-sm font-semibold text-slate-900">代码审查 Agent</span>
        </div>
        <button
          onClick={newChat}
          title="新对话"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-[background-color,color,transform] hover:bg-indigo-50 hover:text-indigo-700 active:scale-95"
        >
          <Plus size={17} />
        </button>
      </div>

      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {sessions.length === 0 && (
          <p className="px-3 py-10 text-center text-xs leading-relaxed text-slate-400">
            暂无会话。
            <br />
            点击右上角 + 新建对话，
            <br />
            或等待 Webhook 触发审查。
          </p>
        )}

        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.key);
          const hasActive = group.sessions.some((s) => s.id === sessionId);
          return (
            <div key={group.key} className="select-none">
              <button
                onClick={() => toggle(group.key)}
                title={group.path ?? group.name}
                className="group/header flex w-full items-center gap-1.5 rounded-lg px-2 py-2 text-left transition-[background-color] hover:bg-slate-50"
              >
                <ChevronRight
                  size={14}
                  className={cn('shrink-0 text-slate-400 transition-transform', !isCollapsed && 'rotate-90')}
                />
                <FolderGit2 size={14} className={cn('shrink-0', hasActive ? 'text-indigo-600' : 'text-slate-400')} />
                <span
                  className={cn(
                    'truncate text-xs font-semibold',
                    hasActive ? 'text-indigo-700' : 'text-slate-700',
                  )}
                >
                  {group.name}
                </span>
                <span className="ml-auto shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-slate-500">
                  {group.sessions.length}
                </span>
              </button>

              {!isCollapsed && (
                <div className="mb-0.5 ml-[15px] space-y-0.5 border-l border-slate-200/70 pl-1.5">
                  {group.sessions.map((s) => {
                    const active = s.id === sessionId;
                    return (
                      <div
                        key={s.id}
                        className={cn(
                          'group relative rounded-lg transition-[background-color]',
                          active ? 'bg-indigo-50' : 'hover:bg-slate-50',
                        )}
                      >
                        {active && (
                          <span className="absolute -left-[7px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-indigo-600" />
                        )}
                        <button
                          onClick={() => navigate(`/c/${s.id}`)}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 pr-8 text-left"
                        >
                          {s.kind === 'review' ? (
                            <GitPullRequest
                              size={13}
                              className={cn('shrink-0', active ? 'text-indigo-500' : 'text-slate-400')}
                            />
                          ) : (
                            <MessageSquare
                              size={13}
                              className={cn('shrink-0', active ? 'text-indigo-500' : 'text-slate-400')}
                            />
                          )}
                          <span
                            className={cn(
                              'truncate text-xs',
                              active ? 'font-medium text-indigo-900' : 'text-slate-700',
                            )}
                          >
                            {sessionLabel(s)}
                          </span>
                          <span
                            title={statusLabel[s.status] ?? s.status}
                            className={cn(
                              'ml-auto h-1.5 w-1.5 shrink-0 rounded-full',
                              statusColor[s.status] ?? 'bg-slate-300',
                              s.status === 'running' && 'animate-pulse',
                            )}
                          />
                        </button>
                        <button
                          type="button"
                          aria-label="删除会话"
                          title="删除会话"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeSession(s.id);
                          }}
                          className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 opacity-0 transition-[opacity,background-color,color,transform] hover:bg-rose-50 hover:text-rose-600 active:scale-95 group-focus-within:opacity-100 group-hover:opacity-100"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-0.5 border-t border-slate-200/80 px-2 py-2 text-sm">
        <Link
          to="/repositories"
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-600 transition-[background-color,color,transform] hover:bg-indigo-50 hover:text-indigo-700 active:scale-[0.98]"
        >
          <FolderGit2 size={15} /> 仓库配置
        </Link>
        <Link
          to="/settings"
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-600 transition-[background-color,color,transform] hover:bg-indigo-50 hover:text-indigo-700 active:scale-[0.98]"
        >
          <SettingsIcon size={15} /> 设置
        </Link>
        <button
          onClick={logout}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-slate-600 transition-[background-color,color,transform] hover:bg-rose-50 hover:text-rose-600 active:scale-[0.98]"
        >
          <LogOut size={15} /> 退出登录
        </button>
      </div>
    </aside>
  );
}
