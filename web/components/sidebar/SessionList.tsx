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
    <div className="flex-1 space-y-1 overflow-y-auto px-2.5 py-2 max-md:max-h-56">
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

      {!loadError && sessions.length > 0 && (
        <div className="px-2 pb-1 pt-1">
          <span className="eyebrow text-[var(--muted)]">最近活动</span>
        </div>
      )}

      {sessions.map((s) => {
        const active = s.id === activeSessionId;
        return (
          <div
            key={s.id}
            className={cn(
              'group relative rounded-[var(--r-md)] transition-colors',
              active ? 'bg-white shadow-[inset_0_0_0_1px_var(--hairline)]' : 'hover:bg-white',
            )}
          >
            {active && <span className="absolute left-0 top-1/2 h-7 w-[2px] -translate-y-1/2 rounded-full bg-[var(--ink)]" />}
            <button
              onClick={() => onSelect(s.id)}
              className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-[var(--r-md)] px-2.5 py-2.5 pr-8 text-left"
            >
              {s.kind === 'review' ? (
                <GitPullRequest size={13} className={cn('shrink-0', active ? 'text-[var(--ink)]' : 'text-[var(--muted)]')} />
              ) : (
                <MessageSquare size={13} className={cn('shrink-0', active ? 'text-[var(--ink)]' : 'text-[var(--muted)]')} />
              )}
              <span className="min-w-0">
                <span
                  className={cn('block truncate text-[13px]', active ? 'font-semibold text-[var(--ink)]' : 'font-medium text-[var(--body-strong)]')}
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
                onDelete(s);
              }}
              className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-[var(--r-pill)] text-[var(--muted-soft)] opacity-0 transition-[opacity,background-color,color] hover:bg-[var(--brand-coral)]/12 hover:text-[var(--brand-coral)] group-focus-within:opacity-100 group-hover:opacity-100"
            >
              <Trash2 size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
