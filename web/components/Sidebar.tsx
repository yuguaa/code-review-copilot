import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { GitPullRequest, MessageSquare, Plus, Settings as SettingsIcon, FolderGit2, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import type { SessionListItem, RepositoryItem } from '../lib/types';

const statusColor: Record<string, string> = {
  running: 'bg-amber-400',
  completed: 'bg-emerald-400',
  failed: 'bg-rose-400',
};

export function Sidebar({ refreshKey }: { refreshKey?: number }) {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const navigate = useNavigate();
  const { sessionId } = useParams();

  const load = useCallback(async () => {
    const data = await api<{ sessions: SessionListItem[] }>('/api/sessions').catch(() => ({ sessions: [] }));
    setSessions(data.sessions);
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const newChat = async () => {
    const repos = await api<{ repositories: RepositoryItem[] }>('/api/repositories').catch(() => ({ repositories: [] }));
    if (repos.repositories.length === 0) {
      toast.error('请先在「仓库配置」添加一个仓库（含模型配置）');
      return;
    }
    const { session } = await api<{ session: { id: string } }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ repositoryId: repos.repositories[0].id, title: '新对话' }),
    });
    await load();
    navigate(`/c/${session.id}`);
  };

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.href = '/login';
  };

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-neutral-800 bg-neutral-950">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-semibold">代码审查 Agent</span>
        <button
          onClick={newChat}
          title="新对话"
          className="rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-100"
        >
          <Plus size={16} />
        </button>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
        {sessions.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-neutral-600">暂无会话。Webhook 触发审查后会出现在这里。</p>
        )}
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => navigate(`/c/${s.id}`)}
            className={cn(
              'group flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left transition',
              s.id === sessionId ? 'bg-neutral-800' : 'hover:bg-neutral-900',
            )}
          >
            <div className="flex items-center gap-2">
              {s.kind === 'review' ? (
                <GitPullRequest size={14} className="shrink-0 text-neutral-400" />
              ) : (
                <MessageSquare size={14} className="shrink-0 text-neutral-400" />
              )}
              <span className="truncate text-xs font-medium text-neutral-200">
                {s.kind === 'review' && s.mrIid ? `!${s.mrIid} ` : ''}
                {s.title ?? s.repository?.name ?? '会话'}
              </span>
              <span className={cn('ml-auto h-1.5 w-1.5 shrink-0 rounded-full', statusColor[s.status] ?? 'bg-neutral-600')} />
            </div>
            {s.repository && (
              <span className="truncate pl-6 text-[11px] text-neutral-500">{s.repository.path}</span>
            )}
            {s.preview && <span className="truncate pl-6 text-[11px] text-neutral-600">{s.preview}</span>}
          </button>
        ))}
      </div>

      <div className="space-y-1 border-t border-neutral-800 px-2 py-2 text-sm">
        <Link to="/repositories" className="flex items-center gap-2 rounded-lg px-3 py-2 text-neutral-300 transition hover:bg-neutral-900">
          <FolderGit2 size={15} /> 仓库配置
        </Link>
        <Link to="/settings" className="flex items-center gap-2 rounded-lg px-3 py-2 text-neutral-300 transition hover:bg-neutral-900">
          <SettingsIcon size={15} /> 设置
        </Link>
        <button onClick={logout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-neutral-300 transition hover:bg-neutral-900">
          <LogOut size={15} /> 退出登录
        </button>
      </div>
    </aside>
  );
}
