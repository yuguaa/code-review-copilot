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
    <div className="h-full overflow-y-auto bg-[var(--canvas)]">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--hairline)] bg-[var(--canvas)] px-6 py-4">
        <Link
          to="/"
          aria-label="返回"
          className="flex h-9 w-9 items-center justify-center rounded-[var(--r-pill)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-card)] hover:text-[var(--ink)]"
        >
          <ArrowLeft size={16} />
        </Link>
        <h1 className="font-display text-lg text-[var(--ink)]">{title}</h1>
      </header>
      <main className={cn('mx-auto space-y-8 px-6 py-10', maxWidth)}>{children}</main>
    </div>
  );
}
