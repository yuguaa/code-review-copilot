import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('tech-panel rounded-[var(--r-lg)] p-6', className)}>
      {children}
    </div>
  );
}

const COLOR_BLOCK_SURFACE: Record<string, { bg: string; dark: boolean }> = {
  lime: { bg: 'var(--metric-lime)', dark: true },
  lilac: { bg: 'var(--metric-lilac)', dark: true },
  cream: { bg: 'var(--metric-neutral)', dark: true },
  mint: { bg: 'var(--metric-mint)', dark: true },
  pink: { bg: 'var(--metric-pink)', dark: true },
  coral: { bg: 'var(--metric-coral)', dark: true },
  navy: { bg: 'var(--metric-navy)', dark: true },
  teal: { bg: 'var(--metric-teal)', dark: true },
};

export function ColorBlock({
  tone = 'cream',
  className,
  children,
}: {
  tone?: 'lime' | 'lilac' | 'cream' | 'mint' | 'pink' | 'coral' | 'navy' | 'teal';
  className?: string;
  children: ReactNode;
}) {
  const surface = COLOR_BLOCK_SURFACE[tone];
  return (
    <div
      className={cn('tech-panel rounded-[var(--r-lg)] p-8', surface.dark ? 'is-dark text-white' : 'text-[var(--ink)]', className)}
      style={{
        backgroundColor: surface.bg,
        borderColor: surface.dark ? 'var(--line-strong)' : 'var(--line-default)',
      }}
    >
      {children}
    </div>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('caption text-[var(--muted)]', className)}>{children}</span>;
}

export function BadgePill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'line-tag inline-flex items-center gap-1 rounded-[var(--r-pill)] bg-[var(--surface-soft)] px-2.5 py-1 text-[13px] font-medium text-[var(--body-strong)]',
        className,
      )}
    >
      {children}
    </span>
  );
}
