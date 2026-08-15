import { NavLink } from 'react-router-dom';
import BarChart3 from 'lucide-react/dist/esm/icons/chart-column';
import FolderGit2 from 'lucide-react/dist/esm/icons/folder-git-2';
import CircleHelp from 'lucide-react/dist/esm/icons/circle-help';
import LogOut from 'lucide-react/dist/esm/icons/log-out';
import SettingsIcon from 'lucide-react/dist/esm/icons/settings';

export function SidebarNav({ onNavigate, onLogout }: { onNavigate: () => void; onLogout: () => void }) {
  const itemClass =
    'flex h-10 items-center gap-2.5 rounded-[var(--r-lg)] px-3 text-[var(--body)] transition-[background-color,color,transform] hover:bg-[var(--surface-card)] hover:text-[var(--ink)] active:scale-[0.98]';

  return (
    <nav aria-label="主导航" className="sidebar-nav space-y-1 border-t border-[var(--line-default)] px-3 py-3 text-sm">
      <NavLink
        to="/dashboard"
        title="数据看板"
        onClick={onNavigate}
        className={({ isActive }) => `${itemClass} ${isActive ? 'bg-[var(--primary)] font-semibold text-white hover:bg-[var(--primary-hover)] hover:text-white' : ''}`}
      >
        <BarChart3 size={15} /> 数据看板
      </NavLink>
      <NavLink
        to="/repositories"
        title="仓库配置"
        onClick={onNavigate}
        className={({ isActive }) => `${itemClass} ${isActive ? 'bg-[var(--primary)] font-semibold text-white hover:bg-[var(--primary-hover)] hover:text-white' : ''}`}
      >
        <FolderGit2 size={15} /> 仓库配置
      </NavLink>
      <NavLink
        to="/settings"
        title="设置"
        onClick={onNavigate}
        className={({ isActive }) => `${itemClass} ${isActive ? 'bg-[var(--primary)] font-semibold text-white hover:bg-[var(--primary-hover)] hover:text-white' : ''}`}
      >
        <SettingsIcon size={15} /> 设置
      </NavLink>
      <NavLink
        to="/help"
        title="帮助中心"
        onClick={onNavigate}
        className={({ isActive }) => `${itemClass} ${isActive ? 'bg-[var(--primary)] font-semibold text-white hover:bg-[var(--primary-hover)] hover:text-white' : ''}`}
      >
        <CircleHelp size={15} /> 帮助中心
      </NavLink>
      <button
        onClick={onLogout}
        title="退出登录"
        className={`${itemClass} w-full cursor-pointer hover:bg-[var(--state-error-bg)] hover:text-[var(--error)]`}
      >
        <LogOut size={15} /> 退出登录
      </button>
    </nav>
  );
}
