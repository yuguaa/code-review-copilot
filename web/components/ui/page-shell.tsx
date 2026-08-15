import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { WorkbenchMenuButton } from '../layout/WorkbenchShell';

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
    <div className="ops-page-shell flex h-full min-h-0 flex-col">
      <header className="ops-page-header h-16 shrink-0 border-b border-[var(--line-default)] bg-[var(--header-surface)]">
        <div className={cn('mx-auto flex h-full items-center gap-3 px-4 sm:px-6 lg:px-7', maxWidth)}>
          <WorkbenchMenuButton />
          <p className="min-w-0 truncate text-base font-semibold text-[var(--ink)]">{title}</p>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn('relative mx-auto space-y-5 p-4 sm:p-6 lg:p-7', maxWidth)}>
          <h1 className="font-display text-2xl leading-tight text-[var(--ink)]">{title}</h1>
          {children}
        </div>
      </main>
    </div>
  );
}
