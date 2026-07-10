import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'onColor' | 'danger' | 'magenta' | 'icon' }) {
  const styles = {
    primary: 'border border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)] shadow-[var(--shadow-sm)] hover:border-[var(--brand-magenta)] hover:bg-[var(--brand-magenta)]',
    secondary: 'border border-[var(--line-default)] bg-[var(--surface-card)] text-[var(--ink)] shadow-[var(--shadow-sm)] hover:border-[var(--line-accent)] hover:bg-[var(--surface-hover)]',
    onColor: 'border border-white/70 bg-white text-[var(--on-light)] shadow-[var(--shadow-sm)] hover:bg-[var(--light-control-hover)]',
    danger: 'border border-[var(--error)]/35 bg-[var(--surface-card)] text-[var(--error)] hover:border-[var(--error)]/60 hover:bg-[var(--state-error-bg)]',
    magenta: 'border border-[var(--brand-magenta)] bg-[var(--brand-magenta)] text-white shadow-[var(--shadow-sm)] hover:border-[var(--ink)] hover:bg-[var(--ink)]',
    icon: 'h-10 w-10 rounded-[var(--r-sm)] border border-[var(--primary)] bg-[var(--primary)] p-0 text-[var(--on-primary)] shadow-[var(--shadow-sm)] hover:border-[var(--brand-magenta)] hover:bg-[var(--brand-magenta)]',
  }[variant];
  return (
    <button
      {...props}
      className={cn(
        'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[var(--r-sm)] px-4 py-2.5 text-sm font-semibold transition-[background-color,border-color,opacity,transform,box-shadow] active:translate-y-px active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45',
        styles,
        className,
      )}
    />
  );
}
