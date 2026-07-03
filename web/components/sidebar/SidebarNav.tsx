import { Link } from 'react-router-dom';
import { BarChart3, FolderGit2, LogOut, Settings as SettingsIcon } from 'lucide-react';

export function SidebarNav({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="space-y-0.5 border-t border-[var(--hairline)] bg-white px-2.5 py-2.5 text-sm max-md:grid max-md:grid-cols-2 max-md:gap-1 max-md:space-y-0">
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
        onClick={onLogout}
        className="flex w-full items-center gap-2.5 rounded-[var(--r-md)] px-3 py-2 text-[var(--body)] transition-colors hover:bg-[var(--brand-coral)]/10 hover:text-[var(--brand-coral)]"
      >
        <LogOut size={15} /> 退出登录
      </button>
    </div>
  );
}
