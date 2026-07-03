import { Link } from 'react-router-dom';
import BarChart3 from 'lucide-react/dist/esm/icons/chart-column';
import FolderGit2 from 'lucide-react/dist/esm/icons/folder-git-2';
import LogOut from 'lucide-react/dist/esm/icons/log-out';
import SettingsIcon from 'lucide-react/dist/esm/icons/settings';

export function SidebarNav({ onLogout }: { onLogout: () => void }) {
  const itemClass =
    'flex min-h-10 items-center gap-2.5 rounded-[var(--r-md)] px-3 py-2 text-[var(--body)] transition-[background-color,color,transform] hover:bg-[var(--surface-card)] hover:text-[var(--ink)] active:translate-y-px active:scale-[0.99]';

  return (
    <div className="space-y-0.5 border-t border-white/70 bg-[rgba(251,252,248,0.58)] px-2.5 py-2.5 text-sm max-md:grid max-md:grid-cols-2 max-md:gap-1 max-md:space-y-0">
      <Link
        to="/dashboard"
        className={itemClass}
      >
        <BarChart3 size={15} /> 数据看板
      </Link>
      <Link
        to="/repositories"
        className={itemClass}
      >
        <FolderGit2 size={15} /> 仓库配置
      </Link>
      <Link
        to="/settings"
        className={itemClass}
      >
        <SettingsIcon size={15} /> 设置
      </Link>
      <button
        onClick={onLogout}
        className="flex min-h-10 w-full items-center gap-2.5 rounded-[var(--r-md)] px-3 py-2 text-[var(--body)] transition-[background-color,color,transform] hover:bg-[var(--brand-coral)]/10 hover:text-[var(--brand-coral)] active:translate-y-px active:scale-[0.99]"
      >
        <LogOut size={15} /> 退出登录
      </button>
    </div>
  );
}
