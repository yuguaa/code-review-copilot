import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  GitPullRequest,
  MessageSquare,
  Plus,
  Settings as SettingsIcon,
  FolderGit2,
  LogOut,
  Trash2,
  ScanSearch,
  GitBranch,
  AlertCircle,
  BarChart3,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { Button, Modal, useConfirm } from './ui';
import type { SessionListItem, RepositoryItem } from '../lib/types';

const statusColor: Record<string, string> = {
  running: 'bg-[var(--brand-cream)]',
  completed: 'bg-[var(--success)]',
  failed: 'bg-[var(--brand-coral)]',
};

const statusLabel: Record<string, string> = {
  running: '审查进行中',
  completed: '已完成',
  failed: '失败',
};

/** 会话标题展示：审查会话带 MR 编号，普通对话空标题回退「新对话」。 */
function sessionLabel(s: SessionListItem): string {
  if (s.kind === 'review') {
    const prefix = s.mrIid ? `!${s.mrIid} ` : '';
    return `${prefix}${s.title || '代码审查'}`;
  }
  return s.title || '新对话';
}

function sessionMeta(s: SessionListItem): string {
  const branch =
    s.sourceBranch && s.targetBranch ? `${s.sourceBranch} → ${s.targetBranch}` : s.sourceBranch ?? s.targetBranch;
  const time = new Date(s.updatedAt).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return [branch, time].filter(Boolean).join(' · ');
}

function repositoryLabel(s: SessionListItem): string {
  return s.repository?.name || s.repository?.path?.split('/').pop() || '未关联仓库';
}

/** 新建对话弹层：明确选择仓库，而不是默默用第一个。 */
function NewChatModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [repos, setRepos] = useState<RepositoryItem[] | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    setRepos(null);
    api<{ repositories: RepositoryItem[] }>('/api/repositories')
      .then((d) => {
        setRepos(d.repositories);
        setSelected(d.repositories[0]?.id ?? '');
      })
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : '仓库列表加载失败');
        setRepos([]);
      });
  }, [open]);

  const create = () => {
    if (!selected) return;
    setCreating(true);
    api<{ session: { id: string } }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ repositoryId: selected }),
    })
      .then(({ session }) => {
        onClose();
        navigate(`/c/${session.id}`);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : '创建失败'))
      .finally(() => setCreating(false));
  };

  return (
    <Modal open={open} title="新建对话" onClose={onClose} maxWidth="max-w-md">
      {repos == null ? (
        <p className="py-4 text-center text-sm text-[var(--muted)]">加载仓库中…</p>
      ) : repos.length === 0 ? (
        <div className="space-y-3 py-2 text-center">
          <p className="text-sm text-[var(--body-strong)]">还没有可用仓库</p>
          <p className="text-xs text-[var(--muted)]">对话需要挂在一个仓库下，Agent 才能读取它的代码与记忆。</p>
          <Link to="/repositories" onClick={onClose} className="inline-block text-sm font-semibold text-[var(--brand-coral)] hover:underline">
            去仓库配置 →
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-[var(--muted)]">选择对话关联的仓库，Agent 将在该仓库的工作区内回答问题。</p>
          <div className="max-h-72 space-y-1.5 overflow-y-auto">
            {repos.map((r) => (
              <label
                key={r.id}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 rounded-[var(--r-md)] border px-3 py-2.5 text-sm transition-colors',
                  selected === r.id
                    ? 'border-[var(--ink)] bg-[var(--surface-card)] text-[var(--ink)]'
                    : 'border-[var(--hairline)] text-[var(--body)] hover:bg-[var(--surface-card)]',
                )}
              >
                <input
                  type="radio"
                  name="new-chat-repo"
                  checked={selected === r.id}
                  onChange={() => setSelected(r.id)}
                  className="accent-[var(--ink)]"
                />
                <FolderGit2 size={14} className="shrink-0 text-[var(--muted)]" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.name}</span>
                  <span className="block truncate text-xs text-[var(--muted)]">{r.path}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} type="button" disabled={creating}>
              取消
            </Button>
            <Button onClick={create} disabled={creating || !selected}>
              {creating ? '创建中…' : '开始对话'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function Sidebar({ refreshKey }: { refreshKey?: number }) {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const navigate = useNavigate();
  const { sessionId } = useParams();
  const { confirm, element: confirmElement } = useConfirm();

  const load = useCallback(() => {
    return api<{ sessions: SessionListItem[] }>('/api/sessions')
      .then((data) => {
        setSessions(data.sessions);
        setLoadError(null);
      })
      .catch((e) => {
        setLoadError(e instanceof Error ? e.message : '加载失败');
      })
      .finally(() => setLoaded(true));
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

  const logout = () => {
    api('/api/auth/logout', { method: 'POST' })
      .catch(() => undefined)
      .then(() => {
        window.location.href = '/login';
      });
  };

  const removeSession = (s: SessionListItem) => {
    void confirm({
      title: '删除会话',
      description: `「${sessionLabel(s)}」及其全部消息将被删除，无法恢复。`,
    }).then((ok) => {
      if (!ok) return;
      api(`/api/sessions/${s.id}`, { method: 'DELETE' })
        .then(load)
        .then(() => {
          if (s.id === sessionId) navigate('/');
          toast.success('已删除会话');
        })
        .catch((e) => toast.error(e instanceof Error ? e.message : '删除失败'));
    });
  };

  return (
    <aside className="z-20 flex h-full w-80 shrink-0 flex-col border-r border-[var(--hairline)] bg-[var(--canvas)] max-md:h-auto max-md:w-full max-md:border-b max-md:border-r-0">
      <div className="px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-pill)] bg-[var(--ink)] text-white">
              <ScanSearch size={16} />
            </span>
            <div className="min-w-0">
              <span className="font-display block truncate text-[15px] text-[var(--ink)]">代码审查 Agent</span>
              <span className="caption block truncate text-[var(--muted)]">REVIEW WORKSPACE</span>
            </div>
          </div>
          <button
            onClick={() => setNewChatOpen(true)}
            title="新对话"
            aria-label="新对话"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-pill)] bg-[var(--primary)] text-white transition-opacity hover:opacity-90 active:scale-95"
          >
            <Plus size={17} />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto px-2.5 py-2 max-md:max-h-56">
        {loadError && (
          <div className="mx-1 space-y-2 rounded-[var(--r-md)] border border-[var(--brand-coral)]/30 bg-[var(--brand-coral)]/8 px-3 py-3 text-center">
            <p className="flex items-center justify-center gap-1.5 text-xs font-semibold text-[var(--brand-coral)]">
              <AlertCircle size={13} /> 会话列表加载失败
            </p>
            <p className="break-words text-[11px] text-[var(--muted)]">{loadError}</p>
            <Button variant="secondary" className="h-7 px-3 py-0 text-xs" onClick={() => void load()}>
              重试
            </Button>
          </div>
        )}
        {!loadError && loaded && sessions.length === 0 && (
          <p className="px-3 py-10 text-center text-xs leading-relaxed text-[var(--muted-soft)]">
            暂无会话。
            <br />
            点击右上角 + 新建对话，
            <br />
            或等待 Webhook 触发审查。
          </p>
        )}

        {!loadError && sessions.length > 0 && (
          <div className="px-2 pb-1 pt-1">
            <span className="eyebrow text-[var(--muted)]">最近活动</span>
          </div>
        )}

        {sessions.map((s) => {
          const active = s.id === sessionId;
          return (
            <div
              key={s.id}
              className={cn(
                'group relative rounded-[var(--r-md)] transition-colors',
                active ? 'bg-[var(--surface-card)]' : 'hover:bg-[var(--surface-card)]',
              )}
            >
              {active && <span className="absolute left-0 top-1/2 h-8 w-[2px] -translate-y-1/2 rounded-full bg-[var(--ink)]" />}
              <button
                onClick={() => navigate(`/c/${s.id}`)}
                className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-[var(--r-md)] px-2.5 py-2.5 pr-8 text-left"
              >
                {s.kind === 'review' ? (
                  <GitPullRequest size={13} className={cn('shrink-0', active ? 'text-[var(--ink)]' : 'text-[var(--muted)]')} />
                ) : (
                  <MessageSquare size={13} className={cn('shrink-0', active ? 'text-[var(--ink)]' : 'text-[var(--muted)]')} />
                )}
                <span className="min-w-0">
                  <span
                    className={cn(
                      'block truncate text-xs',
                      active ? 'font-semibold text-[var(--ink)]' : 'font-medium text-[var(--body-strong)]',
                    )}
                  >
                    {sessionLabel(s)}
                  </span>
                  <span className="caption mt-1 flex min-w-0 items-center gap-1 truncate text-[var(--muted)]">
                    <FolderGit2 size={10} className="shrink-0" />
                    <span className="truncate">{repositoryLabel(s)}</span>
                  </span>
                  <span className="caption mt-0.5 flex min-w-0 items-center gap-1 truncate text-[var(--muted-soft)]">
                    {s.sourceBranch || s.targetBranch ? <GitBranch size={10} className="shrink-0" /> : null}
                    <span className="truncate">{sessionMeta(s)}</span>
                  </span>
                </span>
                <span
                  title={statusLabel[s.status] ?? s.status}
                  className={cn(
                    'ml-auto h-1.5 w-1.5 shrink-0 rounded-full',
                    statusColor[s.status] ?? 'bg-[var(--muted-soft)]',
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
                  removeSession(s);
                }}
                className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-[var(--r-pill)] text-[var(--muted-soft)] opacity-0 transition-[opacity,background-color,color] hover:bg-[var(--brand-coral)]/12 hover:text-[var(--brand-coral)] group-focus-within:opacity-100 group-hover:opacity-100"
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="space-y-0.5 border-t border-[var(--hairline)] px-2.5 py-2.5 text-sm max-md:grid max-md:grid-cols-2 max-md:gap-1 max-md:space-y-0">
        <Link
          to="/dashboard"
          className="flex items-center gap-2.5 rounded-[var(--r-md)] px-3 py-2 text-[var(--body)] transition-colors hover:bg-[var(--surface-card)] hover:text-[var(--ink)]"
        >
          <BarChart3 size={15} /> 数据看板
        </Link>
        <Link
          to="/repositories"
          className="flex items-center gap-2.5 rounded-[var(--r-md)] px-3 py-2 text-[var(--body)] transition-colors hover:bg-[var(--surface-card)] hover:text-[var(--ink)]"
        >
          <FolderGit2 size={15} /> 仓库配置
        </Link>
        <Link
          to="/settings"
          className="flex items-center gap-2.5 rounded-[var(--r-md)] px-3 py-2 text-[var(--body)] transition-colors hover:bg-[var(--surface-card)] hover:text-[var(--ink)]"
        >
          <SettingsIcon size={15} /> 设置
        </Link>
        <button
          onClick={logout}
          className="flex w-full items-center gap-2.5 rounded-[var(--r-md)] px-3 py-2 text-[var(--body)] transition-colors hover:bg-[var(--brand-coral)]/10 hover:text-[var(--brand-coral)]"
        >
          <LogOut size={15} /> 退出登录
        </button>
      </div>

      <NewChatModal open={newChatOpen} onClose={() => setNewChatOpen(false)} />
      {confirmElement}
    </aside>
  );
}
