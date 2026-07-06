import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import { cn } from '../../lib/cn';

export function PageShell({
  title,
  children,
  maxWidth = 'max-w-5xl',
}: {
  title: string;
  children: ReactNode;
  maxWidth?: string;
}) {
  return (
    <div className="ops-page-shell h-full overflow-y-auto">
      <header className="ops-page-header sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--line-default)] bg-[rgba(247,250,247,0.92)] px-6 py-3.5 backdrop-blur">
        <Link
          to="/"
          aria-label="返回"
          className="flex h-10 w-10 items-center justify-center rounded-[var(--r-md)] border border-transparent text-[var(--muted)] transition-[background-color,border-color,color,transform] hover:border-[var(--line-default)] hover:bg-[var(--surface-card)] hover:text-[var(--ink)] active:scale-95"
        >
          <ArrowLeft size={16} />
        </Link>
        <h1 className="font-display text-lg text-[var(--ink)]">{title}</h1>
      </header>
      <main className={cn('relative mx-auto space-y-6 px-6 py-8 max-md:px-4 max-md:py-5', maxWidth)}>{children}</main>
    </div>
  );
}
