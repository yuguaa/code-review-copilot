import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Plus from 'lucide-react/dist/esm/icons/plus';
import ScanSearch from 'lucide-react/dist/esm/icons/scan-search';
import { toast } from 'sonner';
import { api } from '../lib/api';
import type { SessionListItem } from '../lib/types';
import { useSidebarSessions } from '../hooks/useSidebarSessions';
import { useConfirm } from './ui/confirm-dialog';
import { NewChatModal } from './sidebar/NewChatModal';
import { SessionList } from './sidebar/SessionList';
import { SidebarNav } from './sidebar/SidebarNav';
import { sessionLabel } from './sidebar/session-format';

export function Sidebar({ refreshKey }: { refreshKey?: number }) {
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
    <aside className="z-20 flex h-full w-80 shrink-0 flex-col border-r border-white/70 bg-[var(--surface-soft)] shadow-[10px_0_34px_-32px_rgba(31,39,34,0.55)] ring-1 ring-[var(--hairline)] max-md:h-auto max-md:w-full max-md:border-b max-md:border-r-0">
      <div className="px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--r-md)] bg-[var(--primary)] text-white shadow-[var(--shadow-sm)] ring-1 ring-white/20">
              <ScanSearch size={16} />
            </span>
            <div className="min-w-0">
              <span className="font-display block truncate text-[15px] text-[var(--ink)]">代码审查工作台</span>
              <span className="caption block truncate text-[var(--muted)]">REVIEW CONSOLE</span>
            </div>
          </div>
          <button
            onClick={() => setNewChatOpen(true)}
            title="新对话"
            aria-label="新对话"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--r-md)] bg-[var(--primary)] text-white shadow-[var(--shadow-sm)] transition-[opacity,transform,background-color] hover:bg-[var(--body-strong)] active:translate-y-px active:scale-95"
          >
            <Plus size={17} />
          </button>
        </div>
      </div>

      <SessionList
        sessions={sessions}
        activeSessionId={sessionId}
        loadError={loadError}
        loaded={loaded}
        onRetry={() => void load()}
        onSelect={(id) => navigate(`/c/${id}`)}
        onDelete={removeSession}
      />

      <SidebarNav onLogout={logout} />
      <NewChatModal open={newChatOpen} onClose={() => setNewChatOpen(false)} />
      {confirmElement}
    </aside>
  );
}
