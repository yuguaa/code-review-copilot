import { Link } from 'react-router-dom';
import BarChart3 from 'lucide-react/dist/esm/icons/chart-column';
import FolderGit2 from 'lucide-react/dist/esm/icons/folder-git-2';
import LogOut from 'lucide-react/dist/esm/icons/log-out';
import SettingsIcon from 'lucide-react/dist/esm/icons/settings';

export function SidebarNav({ collapsed, onLogout }: { collapsed?: boolean; onLogout: () => void }) {
  const itemClass =
    collapsed
      ? 'flex min-h-10 items-center justify-center rounded-[var(--r-sm)] border border-transparent text-[var(--body)] transition-[background-color,border-color,color,transform] hover:border-[var(--line-default)] hover:bg-[var(--surface-card)] hover:text-[var(--ink)] active:scale-95'
      : 'flex min-h-10 items-center gap-2.5 rounded-[var(--r-sm)] border border-transparent px-3 py-2 text-[var(--body)] transition-[background-color,border-color,color,transform] hover:border-[var(--line-default)] hover:bg-[var(--surface-card)] hover:text-[var(--ink)] active:scale-95';

  return (
    <div className="space-y-0.5 border-t border-[var(--line-default)] bg-[rgba(251,252,248,0.58)] px-2.5 py-2.5 text-sm max-md:grid max-md:grid-cols-2 max-md:gap-1 max-md:space-y-0">
      <Link
        to="/dashboard"
        title="数据看板"
        className={itemClass}
      >
        <BarChart3 size={15} /> {!collapsed && '数据看板'}
      </Link>
      <Link
        to="/repositories"
        title="仓库配置"
        className={itemClass}
      >
        <FolderGit2 size={15} /> {!collapsed && '仓库配置'}
      </Link>
      <Link
        to="/settings"
        title="设置"
        className={itemClass}
      >
        <SettingsIcon size={15} /> {!collapsed && '设置'}
      </Link>
      <button
        onClick={onLogout}
        title="退出登录"
        className={collapsed ? 'flex min-h-10 w-full cursor-pointer items-center justify-center rounded-[var(--r-sm)] border border-transparent text-[var(--body)] transition-[background-color,border-color,color,transform] hover:border-[var(--brand-coral)]/25 hover:bg-[var(--brand-coral)]/10 hover:text-[var(--brand-coral)] active:scale-95' : 'flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-[var(--r-sm)] border border-transparent px-3 py-2 text-[var(--body)] transition-[background-color,border-color,color,transform] hover:border-[var(--brand-coral)]/25 hover:bg-[var(--brand-coral)]/10 hover:text-[var(--brand-coral)] active:scale-95'}
      >
        <LogOut size={15} /> {!collapsed && '退出登录'}
      </button>
    </div>
  );
}
