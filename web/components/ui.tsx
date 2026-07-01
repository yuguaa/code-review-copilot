import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ButtonHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, X } from 'lucide-react';
import { cn } from '../lib/cn';

const fieldBase =
  'w-full rounded-xl border border-white/80 bg-white/86 px-3 py-2 text-sm text-slate-900 shadow-[var(--shadow-control)] outline-none backdrop-blur transition-[border-color,box-shadow,background-color] placeholder:text-slate-500 focus:border-[var(--cyan)] focus:ring-4 focus:ring-cyan-100/80 disabled:bg-slate-50 disabled:opacity-60';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(fieldBase, props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(fieldBase, 'resize-y', props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(fieldBase, 'cursor-pointer', props.className)} />;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold text-slate-700">{label}</span>
      {children}
      {hint && <span className="block text-[11px] leading-relaxed text-slate-500">{hint}</span>}
    </label>
  );
}

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-[var(--accent)] text-white shadow-[0_10px_24px_rgba(37,99,235,0.2)] hover:bg-[var(--accent-strong)]',
    ghost: 'border border-white/80 bg-white/78 text-slate-700 shadow-[var(--shadow-control)] hover:border-cyan-200 hover:bg-[var(--cyan-soft)] hover:text-cyan-700',
    danger: 'border border-rose-200 bg-white/78 text-rose-700 shadow-[var(--shadow-control)] hover:border-rose-300 hover:bg-rose-50',
  }[variant];
  return (
    <button
      {...props}
      className={cn(
        'interactive-lift inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45',
        styles,
        className,
      )}
    />
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'interactive-lift rounded-2xl bg-white/82 p-5 shadow-[var(--shadow-sm)] ring-1 ring-white/80 backdrop-blur hover:shadow-[var(--shadow-glow)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/30 px-4 py-8 backdrop-blur-md">
      <div className="surface-enter w-full max-w-4xl rounded-2xl bg-white/90 shadow-[var(--shadow-lg)] ring-1 ring-white/80 backdrop-blur-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-t-2xl border-b border-slate-100 bg-white/92 px-5 py-4 backdrop-blur">
          <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭弹窗"
            className="interactive-lift flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-950 active:scale-95"
          >
            <X size={17} />
          </button>
        </div>
        <div className="max-h-[calc(100vh-9rem)] overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

export function PageShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="tech-workbench h-full overflow-y-auto">
      <header className="glass-panel sticky top-0 z-10 flex items-center gap-3 border-b border-white/70 px-6 py-3.5">
        <Link
          to="/"
          aria-label="返回"
          className="interactive-lift flex h-8 w-8 items-center justify-center rounded-xl text-slate-500 hover:bg-[var(--cyan-soft)] hover:text-cyan-700 active:scale-95"
        >
          <ArrowLeft size={16} />
        </Link>
        <h1 className="text-sm font-semibold text-slate-950">{title}</h1>
      </header>
      <main className="relative z-10 mx-auto max-w-4xl space-y-6 px-6 py-8">{children}</main>
    </div>
  );
}
