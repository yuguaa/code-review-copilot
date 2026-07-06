import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'onColor' | 'danger' | 'magenta' | 'icon' }) {
  const styles = {
    primary: 'border border-[var(--line-strong)] bg-[var(--primary)] text-[var(--on-primary)] shadow-[var(--shadow-sm)] hover:bg-[var(--body-strong)]',
    secondary: 'border border-[var(--line-default)] bg-[var(--surface-card)] text-[var(--ink)] shadow-[var(--shadow-sm)] hover:border-[var(--line-accent)] hover:bg-white',
    onColor: 'border border-white/70 bg-white text-[var(--ink)] shadow-[var(--shadow-sm)] hover:bg-white/90',
    danger: 'border border-[var(--error)]/30 bg-[var(--surface-card)] text-[var(--error)] hover:border-[var(--error)]/55 hover:bg-[var(--error)]/8',
    magenta: 'border border-[var(--brand-pink)] bg-[var(--brand-pink)] text-white shadow-[var(--shadow-sm)] hover:brightness-95',
    icon: 'h-10 w-10 rounded-[var(--r-sm)] border border-[var(--line-strong)] bg-[var(--primary)] p-0 text-[var(--on-primary)] shadow-[var(--shadow-sm)] hover:bg-[var(--body-strong)]',
  }[variant];
  return (
    <button
      {...props}
      className={cn(
        'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[var(--r-sm)] px-4 py-2.5 text-sm font-semibold transition-[background-color,filter,opacity,transform,box-shadow] active:translate-y-px active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45',
        styles,
        className,
      )}
    />
  );
}
