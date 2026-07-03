import { cn } from '../../lib/cn';

export function StreamingCursor({ className }: { className?: string }) {
  return <span className={cn('inline-block h-4 w-1.5 translate-y-0.5 animate-pulse rounded-full bg-[var(--ink)]', className)} />;
}
