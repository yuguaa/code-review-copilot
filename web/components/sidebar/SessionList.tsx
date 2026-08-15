import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert';
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
  loadError: string | null;
  loaded: boolean;
  onRetry: () => void;
  onSelect: (sessionId: string) => void;
  onDelete: (session: SessionListItem) => void;
};

export function SessionList({
  sessions,
  activeSessionId,
  loadError,
  loaded,
  onRetry,
  onSelect,
  onDelete,
}: SessionListProps) {
  return (
    <div className="sidebar-session-list flex-1 overflow-y-auto px-3 py-2">
      {loadError && (
        <div className="mx-1 space-y-2 rounded-[var(--r-md)] border border-[var(--brand-coral)]/30 bg-[var(--brand-coral)]/8 px-3 py-3 text-center">
          <p className="flex items-center justify-center gap-1.5 text-xs font-semibold text-[var(--brand-coral)]">
            <AlertCircle size={13} /> 会话列表加载失败
          </p>
          <p className="break-words text-xs leading-relaxed text-[var(--muted)]">{loadError}</p>
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

      {!loadError && sessions.length > 0 && (
        <div className="mb-2 flex items-center justify-between px-1.5 pt-1">
          <span className="caption text-[var(--muted)]">最近审查</span>
          <span className="caption text-[var(--muted)]">{sessions.length}</span>
        </div>
      )}

      {sessions.map((s) => {
        const active = s.id === activeSessionId;
        return (
          <div
            key={s.id}
            className={cn(
              'sidebar-session-row group relative overflow-hidden transition-[background-color,border-color,box-shadow,transform]',
              active ? 'is-active' : 'hover:bg-[var(--surface-card)]/70',
            )}
          >
            <button
              onClick={() => onSelect(s.id)}
              title={sessionLabel(s)}
              className={cn(
                'grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[var(--r-lg)] px-3 py-3 pr-8 text-left transition-transform active:scale-[0.99]',
              )}
            >
              <span className={cn('sidebar-session-icon', active && 'is-active')}>
                {s.kind === 'review' ? <GitPullRequest size={13} /> : <MessageSquare size={13} />}
              </span>
              <span className="min-w-0">
                <span className={cn('block truncate text-sm leading-5', active ? 'font-semibold text-[var(--ink)]' : 'font-medium text-[var(--body-strong)]')}>
                  {sessionLabel(s)}
                </span>
                <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs leading-[18px] text-[var(--muted)]">
                  <span className="truncate">{repositoryLabel(s)}</span>
                  <span className="h-0.5 w-0.5 shrink-0 rounded-full bg-[var(--muted-soft)]/60" />
                  <span className="truncate font-mono">{sessionMeta(s)}</span>
                </span>
              </span>
              <span
                title={statusLabel[s.status] ?? s.status}
                className={cn(
                  'ml-auto h-1.5 w-1.5 shrink-0 rounded-full opacity-85 ring-2 ring-[var(--surface-card)]',
                  statusColor[s.status] ?? 'bg-[var(--muted-soft)]',
                  s.status === 'running' && 'status-breathe',
                )}
              />
            </button>
            <button
              type="button"
              aria-label="删除会话"
              title="删除会话"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(s);
              }}
              className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[var(--r-lg)] text-[var(--muted-soft)] opacity-0 transition-[opacity,background-color,color,transform] hover:bg-[var(--state-error-bg)] hover:text-[var(--error)] active:scale-[0.96] group-focus-within:opacity-100 group-hover:opacity-100 max-lg:opacity-100"
            >
              <Trash2 size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
