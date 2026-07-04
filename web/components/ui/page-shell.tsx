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
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/70 bg-[rgba(245,247,242,0.9)] px-6 py-4 shadow-[0_18px_42px_-38px_rgba(31,39,34,0.5)] backdrop-blur">
        <Link
          to="/"
          aria-label="返回"
          className="flex h-10 w-10 items-center justify-center rounded-[var(--r-md)] text-[var(--muted)] transition-[background-color,color,transform] hover:bg-[var(--surface-card)] hover:text-[var(--ink)] active:scale-95"
        >
          <ArrowLeft size={16} />
        </Link>
        <h1 className="font-display text-lg text-[var(--ink)]">{title}</h1>
      </header>
      <main className={cn('mx-auto space-y-8 px-6 py-10', maxWidth)}>{children}</main>
    </div>
  );
}
