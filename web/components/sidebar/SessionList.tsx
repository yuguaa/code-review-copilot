import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert';
import FolderGit2 from 'lucide-react/dist/esm/icons/folder-git-2';
import GitBranch from 'lucide-react/dist/esm/icons/git-branch';
import GitPullRequest from 'lucide-react/dist/esm/icons/git-pull-request';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import { cn } from '../../lib/cn';
import type { SessionListItem } from '../../lib/types';
import { Button } from '../ui/button';
import { repositoryLabel, sessionLabel, sessionMeta, statusColor, statusLabel } from './session-format';

type SessionListProps = {
  sessions: SessionListItem[];
  activeSessionId?: string;
  collapsed?: boolean;
  loadError: string | null;
  loaded: boolean;
  onRetry: () => void;
  onSelect: (sessionId: string) => void;
  onDelete: (session: SessionListItem) => void;
};

export function SessionList({
  sessions,
  activeSessionId,
  collapsed,
  loadError,
  loaded,
  onRetry,
  onSelect,
  onDelete,
}: SessionListProps) {
  return (
    <div className={cn('flex-1 space-y-1 overflow-y-auto py-2 max-md:max-h-56', collapsed ? 'px-2' : 'px-2')}>
      {loadError && (
        <div className="mx-1 space-y-2 rounded-[var(--r-md)] border border-[var(--brand-coral)]/30 bg-[var(--brand-coral)]/8 px-3 py-3 text-center">
          <p className="flex items-center justify-center gap-1.5 text-xs font-semibold text-[var(--brand-coral)]">
            <AlertCircle size={13} /> 会话列表加载失败
          </p>
          <p className="break-words text-[11px] text-[var(--muted)]">{loadError}</p>
          <Button variant="secondary" className="h-7 px-3 py-0 text-xs" onClick={onRetry}>
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

      {!collapsed && !loadError && sessions.length > 0 && (
        <div className="px-2 pb-1 pt-1">
          <span className="eyebrow text-[var(--muted)]">最近审查</span>
        </div>
      )}

      {sessions.map((s) => {
        const active = s.id === activeSessionId;
        return (
          <div
            key={s.id}
            className={cn(
              'group relative overflow-hidden rounded-[var(--r-md)] transition-[background-color,box-shadow,transform]',
              active
                ? 'bg-white shadow-[0_12px_28px_-24px_rgba(31,39,34,0.42)] ring-1 ring-[rgba(31,39,34,0.06)]'
                : 'hover:bg-white/70',
            )}
          >
            {active && <span className="absolute bottom-2 left-0 top-2 w-1 rounded-r-full bg-[var(--accent)] shadow-[0_0_0_4px_rgba(158,196,106,0.14)]" />}
            <button
              onClick={() => onSelect(s.id)}
              title={sessionLabel(s)}
              className={cn(
                'grid w-full items-center gap-2 rounded-[var(--r-md)] text-left active:scale-[0.99]',
                collapsed ? 'h-10 grid-cols-1 place-items-center px-0 py-0' : 'grid-cols-[auto_minmax(0,1fr)_auto] px-3 py-2.5 pr-8',
              )}
            >
              {s.kind === 'review' ? (
                <GitPullRequest size={13} className={cn('shrink-0', active ? 'text-[var(--ink)]' : 'text-[var(--muted)]')} />
              ) : (
                <MessageSquare size={13} className={cn('shrink-0', active ? 'text-[var(--ink)]' : 'text-[var(--muted)]')} />
              )}
              {!collapsed && <span className="min-w-0">
                <span className={cn('block truncate text-[13px]', active ? 'font-semibold text-[var(--ink)]' : 'font-medium text-[var(--body-strong)]')}>
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
              </span>}
              {!collapsed && <span
                title={statusLabel[s.status] ?? s.status}
                className={cn(
                  'ml-auto h-1.5 w-1.5 shrink-0 rounded-full',
                  statusColor[s.status] ?? 'bg-[var(--muted-soft)]',
                  s.status === 'running' && 'status-breathe',
                )}
              />}
            </button>
            {!collapsed && <button
              type="button"
              aria-label="删除会话"
              title="删除会话"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(s);
              }}
              className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[var(--r-sm)] text-[var(--muted-soft)] opacity-0 transition-[opacity,background-color,color,transform] hover:bg-[var(--brand-coral)]/12 hover:text-[var(--brand-coral)] active:scale-95 group-focus-within:opacity-100 group-hover:opacity-100"
            >
              <Trash2 size={13} />
            </button>}
          </div>
        );
      })}
    </div>
  );
}
