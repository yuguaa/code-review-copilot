import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check';
import CircleDashed from 'lucide-react/dist/esm/icons/circle-dashed';
import FolderGit2 from 'lucide-react/dist/esm/icons/folder-git-2';
import GitBranch from 'lucide-react/dist/esm/icons/git-branch';
import Hash from 'lucide-react/dist/esm/icons/hash';
import UserRound from 'lucide-react/dist/esm/icons/user-round';
import { cn } from '../../lib/cn';
import type { SessionDetail } from '../../lib/types';

const statusViewByStatus = {
  running: {
    label: '审查中',
    icon: CircleDashed,
    className: 'border-[var(--warning)]/30 bg-[var(--brand-cream)]/45 text-[var(--ink)]',
  },
  completed: {
    label: '已完成',
    icon: CheckCircle2,
    className: 'border-[var(--success)]/20 bg-white text-[var(--success)]',
  },
  failed: {
    label: '失败',
    icon: AlertCircle,
    className: 'border-[var(--error)]/25 bg-white text-[var(--error)]',
  },
};

function sessionTitle(session: SessionDetail['session']) {
  if (session.kind === 'review' && session.mrIid) return `!${session.mrIid} ${session.mrTitle ?? ''}`;
  return session.title ?? '新对话';
}

function branchLabel(session: SessionDetail['session']) {
  if (session.sourceBranch && session.targetBranch) return `${session.sourceBranch} → ${session.targetBranch}`;
  return session.sourceBranch ?? session.targetBranch ?? null;
}

export function ChatHeader({ session }: { session: SessionDetail['session'] }) {
  const shortHash = session.commitSha ? session.commitSha.slice(0, 8) : null;
  const branchText = branchLabel(session);
  const statusView = statusViewByStatus[session.status as keyof typeof statusViewByStatus] ?? {
    label: session.status,
    icon: CircleDashed,
    className: 'border-[var(--hairline)] bg-white text-[var(--muted)]',
  };
  const StatusIcon = statusView.icon;
  const pill =
    'caption inline-flex max-w-56 items-center gap-1 rounded-[var(--r-pill)] border border-[var(--hairline)] bg-white px-2.5 py-1 text-[var(--body-strong)]';

  return (
    <header className="sticky top-0 z-10 border-b border-[var(--hairline)] bg-[var(--canvas)]/95 px-6 py-3.5 backdrop-blur max-md:px-4">
      <div className="mx-auto flex max-w-4xl min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="font-display truncate text-lg text-[var(--ink)]">{sessionTitle(session)}</h1>
          {session.repository && (
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-[var(--muted)]">
              <FolderGit2 size={12} className="shrink-0 text-[var(--muted-soft)]" /> {session.repository.path}
            </p>
          )}
        </div>
        <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-1.5 text-[11px] font-medium">
          <span className={cn('caption inline-flex items-center gap-1 rounded-[var(--r-pill)] border px-2.5 py-1', statusView.className)}>
            <StatusIcon size={12} className={session.status === 'running' ? 'animate-spin' : undefined} /> {statusView.label}
          </span>
          {branchText && (
            <span className={pill}>
              <GitBranch size={12} className="shrink-0 text-[var(--muted-soft)]" /> <span className="truncate">{branchText}</span>
            </span>
          )}
          {shortHash && (
            <span className={cn(pill, 'font-mono')}>
              <Hash size={12} className="shrink-0 text-[var(--muted-soft)]" /> {shortHash}
            </span>
          )}
          {session.author && (
            <span className={pill}>
              <UserRound size={12} className="shrink-0 text-[var(--muted-soft)]" /> <span className="truncate">{session.author}</span>
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
