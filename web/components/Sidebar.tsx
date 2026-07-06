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
    ? 'sidebar-shell is-collapsed z-20 flex h-full w-[72px] shrink-0 flex-col border-r border-[var(--line-default)] backdrop-blur-xl max-md:h-auto max-md:w-full max-md:border-b max-md:border-r-0'
    : 'sidebar-shell z-20 flex h-full w-[304px] shrink-0 flex-col border-r border-[var(--line-default)] backdrop-blur-xl max-md:h-auto max-md:w-full max-md:border-b max-md:border-r-0';
  const collapseTitle = collapsed ? '展开侧边栏' : '折叠侧边栏';
  const collapseIcon = collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />;

  return (
    <aside className={sidebarClass}>
      <div className="sidebar-brand px-3 pb-2.5 pt-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="sidebar-logo flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--r-md)] text-white">
              <ScanSearch size={16} />
            </span>
            {!collapsed && (
              <div className="min-w-0">
                <span className="font-display block truncate text-[14px] text-[var(--ink)]">代码审查工作台</span>
                <span className="caption block truncate text-[var(--muted)]">Review Console</span>
              </div>
            )}
          </div>
          {!collapsed && (
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                title={collapseTitle}
                aria-label={collapseTitle}
                className="flex h-9 w-9 items-center justify-center rounded-[var(--r-md)] border border-[var(--line-default)] bg-white/42 text-[var(--muted)] transition-[background-color,border-color,color,transform] hover:border-[var(--line-accent)] hover:bg-white/76 hover:text-[var(--ink)] active:scale-95"
              >
                {collapseIcon}
              </button>
              <button
                onClick={() => setNewChatOpen(true)}
                title="新对话"
                aria-label="新对话"
                className="sidebar-action-button flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-md)] text-white transition-[opacity,transform,background-color] active:translate-y-px active:scale-95"
              >
                <MessageSquarePlus size={16} />
              </button>
            </div>
          )}
        </div>
        {collapsed && (
          <div className="mt-3 grid place-items-center gap-2">
            <button
              onClick={() => setNewChatOpen(true)}
              title="新对话"
              aria-label="新对话"
              className="sidebar-action-button flex h-10 w-10 items-center justify-center rounded-[var(--r-md)] text-white transition-[opacity,transform,background-color] active:scale-95"
            >
              <MessageSquarePlus size={16} />
            </button>
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              title={collapseTitle}
              aria-label={collapseTitle}
              className="flex h-10 w-10 items-center justify-center rounded-[var(--r-md)] border border-[var(--line-default)] bg-white/42 text-[var(--muted)] transition-[background-color,border-color,color,transform] hover:border-[var(--line-accent)] hover:bg-white/76 hover:text-[var(--ink)] active:scale-95"
            >
              {collapseIcon}
            </button>
          </div>
        )}
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
