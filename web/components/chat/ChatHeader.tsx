import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check';
import CircleDashed from 'lucide-react/dist/esm/icons/circle-dashed';
import FolderGit2 from 'lucide-react/dist/esm/icons/folder-git-2';
import GitBranch from 'lucide-react/dist/esm/icons/git-branch';
import Hash from 'lucide-react/dist/esm/icons/hash';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link';
import UserRound from 'lucide-react/dist/esm/icons/user-round';
import { cn } from '../../lib/cn';
import type { SessionDetail } from '../../lib/types';
import { WorkbenchMenuButton } from '../layout/WorkbenchShell';

const statusViewByStatus = {
  running: {
    label: '审查中',
    icon: CircleDashed,
    className: 'bg-[var(--brand-lilac)] text-[var(--primary-hover)]',
  },
  completed: {
    label: '已完成',
    icon: CheckCircle2,
    className: 'bg-[var(--state-success-bg)] text-[var(--success)]',
  },
  failed: {
    label: '失败',
    icon: AlertCircle,
    className: 'bg-[var(--state-error-bg)] text-[var(--error)]',
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
    className: 'bg-[var(--surface-soft)] text-[var(--muted)]',
  };
  const StatusIcon = statusView.icon;
  const metadata = 'inline-flex max-w-60 shrink-0 items-center gap-1 text-xs text-[var(--muted)]';

  return (
    <header className="chat-header z-10 h-16 shrink-0 px-4 sm:px-6 lg:px-7">
      <div className="mx-auto flex h-full max-w-[1120px] min-w-0 items-center gap-3">
        <WorkbenchMenuButton />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold leading-5 text-[var(--ink)]">{sessionTitle(session)}</h1>
          {session.repository && (
            <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-[var(--muted)]">
              <FolderGit2 size={12} className="shrink-0" /> {session.repository.path}
            </p>
          )}
        </div>
        <div className="flex min-w-0 shrink items-center gap-3 overflow-x-auto whitespace-nowrap text-xs font-medium">
          <span className={cn('inline-flex h-5 shrink-0 items-center gap-1 rounded-[var(--r-pill)] px-2 text-xs font-medium', statusView.className)}>
            <StatusIcon size={12} className={session.status === 'running' ? 'animate-spin' : undefined} /> {statusView.label}
          </span>
          {branchText && (
            <span className={cn(metadata, 'font-mono')}>
              <GitBranch size={12} className="shrink-0" /> <span className="truncate">{branchText}</span>
            </span>
          )}
          {shortHash && (
            <span className={cn(metadata, 'font-mono')}>
              <Hash size={12} className="shrink-0" /> {shortHash}
            </span>
          )}
          {session.author && (
            <span className={metadata}>
              <UserRound size={12} className="shrink-0" /> <span className="truncate">{session.author}</span>
            </span>
          )}
          {session.webUrl && (
            <a
              href={session.webUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[var(--r-lg)] bg-[var(--primary)] px-2.5 text-xs font-medium text-white transition-[background-color,transform] hover:bg-[var(--primary-hover)] active:scale-[0.96]"
            >
              <ExternalLink size={12} /> GitLab
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
