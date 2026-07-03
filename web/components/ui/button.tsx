import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'onColor' | 'danger' | 'magenta' | 'icon' }) {
  const styles = {
    primary: 'bg-[var(--primary)] text-[var(--on-primary)] hover:bg-[var(--body-strong)]',
    secondary: 'border border-[var(--hairline)] bg-white text-[var(--ink)] hover:bg-[var(--surface-hover)]',
    onColor: 'bg-white text-[var(--ink)] hover:bg-white/90',
    danger: 'border border-[var(--error)]/25 bg-white text-[var(--error)] hover:bg-[var(--error)]/8',
    magenta: 'bg-[var(--brand-pink)] text-[var(--ink)] hover:brightness-95',
    icon: 'h-10 w-10 rounded-[var(--r-sm)] bg-[var(--primary)] p-0 text-[var(--on-primary)] hover:bg-[var(--body-strong)]',
  }[variant];
  return (
    <button
      {...props}
      className={cn(
        'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[var(--r-sm)] px-4 py-2.5 text-sm font-medium transition-[background-color,filter,opacity,transform] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45',
        styles,
        className,
      )}
    />
  );
}
