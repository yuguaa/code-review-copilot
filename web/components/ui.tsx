import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ButtonHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, X } from 'lucide-react';
import { cn } from '../lib/cn';

const fieldBase =
  'w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-slate-900 shadow-[var(--shadow-control)] outline-none transition-[border-color,box-shadow,background-color] placeholder:text-slate-500 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-50 disabled:opacity-60';

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
    primary: 'bg-[var(--accent)] text-white shadow-[var(--shadow-control)] hover:bg-[var(--accent-strong)]',
    ghost: 'border border-[var(--border)] bg-white text-slate-700 shadow-[var(--shadow-control)] hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700',
    danger: 'border border-rose-200 bg-white text-rose-700 shadow-[var(--shadow-control)] hover:border-rose-300 hover:bg-rose-50',
  }[variant];
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-[background-color,color,border-color,box-shadow,transform] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45',
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
        'rounded-xl bg-white p-5 shadow-[var(--shadow-sm)] ring-1 ring-[var(--border)] transition-[box-shadow,transform] hover:shadow-[var(--shadow-md)]',
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/35 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-4xl animate-fade-in rounded-xl bg-white shadow-[var(--shadow-lg)] ring-1 ring-[var(--border)]">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-t-xl border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur">
          <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭弹窗"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-[background-color,color,transform] hover:bg-slate-100 hover:text-slate-950 active:scale-95"
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
    <div className="h-full overflow-y-auto bg-[var(--bg)]">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--border)] bg-white/85 px-6 py-3.5 backdrop-blur-md">
        <Link
          to="/"
          aria-label="返回"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-[background-color,color,transform] hover:bg-indigo-50 hover:text-indigo-700 active:scale-95"
        >
          <ArrowLeft size={16} />
        </Link>
        <h1 className="text-sm font-semibold text-slate-950">{title}</h1>
      </header>
      <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">{children}</main>
    </div>
  );
}
