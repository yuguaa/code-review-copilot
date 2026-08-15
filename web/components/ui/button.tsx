import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'onColor' | 'danger' | 'magenta' | 'icon' }) {
  const styles = {
    primary: 'border border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)] hover:border-[var(--primary-hover)] hover:bg-[var(--primary-hover)]',
    secondary: 'border border-[var(--line-default)] bg-[var(--surface-card)] text-[var(--ink)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-hover)]',
    onColor: 'border border-[var(--line-strong)] bg-white text-[var(--on-light)] hover:border-[var(--primary)] hover:bg-[var(--light-control-hover)]',
    danger: 'border border-[var(--error)]/35 bg-[var(--surface-card)] text-[var(--error)] hover:border-[var(--error)]/60 hover:bg-[var(--state-error-bg)]',
    magenta: 'border border-[var(--primary)] bg-[var(--primary)] text-white hover:border-[var(--primary-hover)] hover:bg-[var(--primary-hover)]',
    icon: 'h-8 w-8 border border-[var(--primary)] bg-[var(--primary)] p-0 text-[var(--on-primary)] hover:border-[var(--primary-hover)] hover:bg-[var(--primary-hover)]',
  }[variant];
  return (
    <button
      {...props}
      className={cn(
        'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--r-lg)] px-2.5 text-sm font-medium outline-none transition-[background-color,border-color,opacity,transform] active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50',
        styles,
        className,
      )}
    />
  );
}
