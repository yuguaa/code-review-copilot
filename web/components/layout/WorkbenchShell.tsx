import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useOutletContext } from 'react-router-dom';
import Menu from 'lucide-react/dist/esm/icons/menu';
import { Sidebar } from '../Sidebar';
import { cn } from '../../lib/cn';

type WorkbenchShellContextValue = {
  openNavigation: () => void;
  refreshSidebar: () => void;
};

export function useWorkbenchShell() {
  return useOutletContext<WorkbenchShellContextValue>();
}

export function WorkbenchMenuButton({ className }: { className?: string }) {
  const { openNavigation } = useWorkbenchShell();

  return (
    <button
      type="button"
      onClick={openNavigation}
      aria-label="打开导航"
      title="打开导航"
      className={cn(
        'hidden h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-lg)] text-[var(--muted)] transition-[background-color,color,transform] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] active:scale-[0.96] max-lg:flex',
        className,
      )}
    >
      <Menu size={17} />
    </button>
  );
}

export function WorkbenchShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const location = useLocation();

  const closeNavigation = useCallback(() => setMobileOpen(false), []);
  const context = useMemo<WorkbenchShellContextValue>(
    () => ({
      openNavigation: () => setMobileOpen(true),
      refreshSidebar: () => setRefreshKey((key) => key + 1),
    }),
    [],
  );

  useEffect(() => {
    closeNavigation();
  }, [closeNavigation, location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeNavigation();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [closeNavigation, mobileOpen]);

  return (
    <div className="review-workbench flex h-full min-h-0 overflow-hidden">
      <Sidebar refreshKey={refreshKey} mobileOpen={mobileOpen} onMobileClose={closeNavigation} />
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <Outlet context={context} />
      </div>
    </div>
  );
}
