import { Fragment, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import MessageSquarePlus from 'lucide-react/dist/esm/icons/message-square-plus';
import ScanSearch from 'lucide-react/dist/esm/icons/scan-search';
import X from 'lucide-react/dist/esm/icons/x';
import { toast } from 'sonner';
import { api } from '../lib/api';
import type { SessionListItem } from '../lib/types';
import { useSidebarSessions } from '../hooks/useSidebarSessions';
import { useConfirm } from './ui/confirm-dialog';
import { NewChatModal } from './sidebar/NewChatModal';
import { SessionList } from './sidebar/SessionList';
import { SidebarNav } from './sidebar/SidebarNav';
import { sessionLabel } from './sidebar/session-format';
import { cn } from '../lib/cn';

export function Sidebar({
  refreshKey,
  mobileOpen,
  onMobileClose,
}: {
  refreshKey?: number;
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const [newChatOpen, setNewChatOpen] = useState(false);
  const navigate = useNavigate();
  const { sessionId } = useParams();
  const { confirm, element: confirmElement } = useConfirm();
  const { sessions, loadError, loaded, load, deleteSession } = useSidebarSessions(refreshKey);

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
      deleteSession(s.id)
        .then(() => {
          if (s.id === sessionId) navigate('/');
        })
        .catch((e) => toast.error(e instanceof Error ? e.message : '删除失败'));
    });
  };

  return (
    <Fragment>
      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-[var(--surface-dark)]/45 backdrop-blur-[1px] lg:hidden"
          onClick={onMobileClose}
          aria-label="关闭导航"
        />
      )}
      <aside
        aria-label="工作台导航"
        className={cn(
          'sidebar-shell fixed inset-y-0 left-0 z-40 flex h-dvh w-60 shrink-0 flex-col border-r border-[var(--line-default)] transition-transform duration-200 lg:relative lg:inset-auto lg:z-20 lg:h-full lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
      <div className="sidebar-brand flex h-16 shrink-0 items-center px-4">
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="sidebar-logo flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-lg)] text-white">
              <ScanSearch size={16} />
            </span>
            <div className="min-w-0">
              <span className="font-display block truncate text-[15px] text-[var(--ink)]">代码审查工作台</span>
              <span className="caption block truncate text-[var(--muted)]">Review Console</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onMobileClose}
            title="关闭导航"
            aria-label="关闭导航"
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-lg)] text-[var(--muted)] transition-[background-color,color,transform] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] active:scale-[0.96] max-lg:flex"
          >
            <X size={17} />
          </button>
        </div>
      </div>

      <div className="px-3 pb-2 pt-3">
        <button
          onClick={() => {
            onMobileClose();
            setNewChatOpen(true);
          }}
          className="sidebar-action-button flex h-8 w-full items-center justify-center gap-2 rounded-[var(--r-lg)] px-3 text-sm font-medium text-white transition-[background-color,transform] active:scale-[0.96]"
        >
          <MessageSquarePlus size={15} />
          新对话
        </button>
      </div>

      <SessionList
        sessions={sessions}
        activeSessionId={sessionId}
        loadError={loadError}
        loaded={loaded}
        onRetry={() => void load()}
        onSelect={(id) => {
          onMobileClose();
          navigate(`/c/${id}`);
        }}
        onDelete={removeSession}
      />

      <SidebarNav onNavigate={onMobileClose} onLogout={logout} />
      <NewChatModal open={newChatOpen} onClose={() => setNewChatOpen(false)} />
      {confirmElement}
      </aside>
    </Fragment>
  );
}
