import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PanelLeftClose from 'lucide-react/dist/esm/icons/panel-left-close';
import PanelLeftOpen from 'lucide-react/dist/esm/icons/panel-left-open';
import MessageSquarePlus from 'lucide-react/dist/esm/icons/message-square-plus';
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
  const [collapsed, setCollapsed] = useState(false);
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

  const sidebarClass = collapsed
    ? 'sidebar-shell is-collapsed z-20 flex h-full w-[72px] shrink-0 flex-col border-r border-[rgba(7,26,18,0.12)] bg-[rgba(238,243,238,0.92)] backdrop-blur-xl max-md:h-auto max-md:w-full max-md:border-b max-md:border-r-0'
    : 'sidebar-shell z-20 flex h-full w-[308px] shrink-0 flex-col border-r border-[rgba(7,26,18,0.12)] bg-[rgba(238,243,238,0.92)] backdrop-blur-xl max-md:h-auto max-md:w-full max-md:border-b max-md:border-r-0';

  return (
    <aside className={sidebarClass}>
      <div className="px-3 pb-2.5 pt-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--r-md)] bg-[var(--primary)] text-white shadow-[0_14px_32px_-18px_rgba(7,26,18,0.74)] ring-1 ring-white/15">
              <ScanSearch size={16} />
            </span>
            {!collapsed && <div className="min-w-0">
              <span className="font-display block truncate text-[14px] text-[var(--ink)]">代码审查工作台</span>
              <span className="caption block truncate text-[var(--muted)]">Review Console</span>
            </div>}
          </div>
          {!collapsed && (
          <button
            onClick={() => setNewChatOpen(true)}
            title="新对话"
            aria-label="新对话"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--r-md)] bg-[var(--primary)] text-white shadow-[0_16px_34px_-20px_rgba(7,26,18,0.7)] transition-[opacity,transform,background-color] hover:bg-[var(--body-strong)] active:translate-y-px active:scale-95"
          >
            <MessageSquarePlus size={17} />
          </button>
          )}
        </div>
        <div className={collapsed ? 'mt-3 grid gap-2' : 'mt-3 flex items-center gap-2'}>
          {collapsed && (
            <button
              onClick={() => setNewChatOpen(true)}
              title="新对话"
              aria-label="新对话"
              className="flex h-9 w-full items-center justify-center rounded-[var(--r-md)] bg-[var(--primary)] text-white shadow-[0_14px_28px_-20px_rgba(7,26,18,0.74)] transition-[opacity,transform,background-color] hover:bg-[var(--body-strong)] active:scale-95"
            >
              <MessageSquarePlus size={15} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
            aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
            className="flex h-9 flex-1 items-center justify-center rounded-[var(--r-md)] border border-[rgba(7,26,18,0.08)] bg-white/62 text-[var(--muted)] shadow-[var(--shadow-sm)] transition-[background-color,color,transform] hover:bg-white hover:text-[var(--ink)] active:scale-95"
          >
            {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        </div>
      </div>

      <SessionList
        sessions={sessions}
        activeSessionId={sessionId}
        collapsed={collapsed}
        loadError={loadError}
        loaded={loaded}
        onRetry={() => void load()}
        onSelect={(id) => navigate(`/c/${id}`)}
        onDelete={removeSession}
      />

      <SidebarNav collapsed={collapsed} onLogout={logout} />
      <NewChatModal open={newChatOpen} onClose={() => setNewChatOpen(false)} />
      {confirmElement}
    </aside>
  );
}
