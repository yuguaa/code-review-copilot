import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ButtonHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, X } from 'lucide-react';
import { cn } from '../lib/cn';

const fieldBase =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-100 disabled:opacity-50';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(fieldBase, props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(fieldBase, 'resize-y', props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(fieldBase, props.className)} />;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-teal-600 text-white shadow-sm shadow-teal-700/20 hover:bg-teal-700',
    ghost: 'border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-sky-50 hover:text-slate-950',
    danger: 'border border-rose-200 bg-white text-rose-600 shadow-sm hover:bg-rose-50',
  }[variant];
  return (
    <button
      {...props}
      className={cn(
        'rounded-lg px-3 py-1.5 text-sm font-medium transition-[background-color,color,border-color,box-shadow,transform] active:scale-95 disabled:opacity-40',
        styles,
        className,
      )}
    />
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-xl bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/70', className)}>{children}</div>;
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/25 px-4 py-8">
      <div className="w-full max-w-4xl rounded-2xl bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)] ring-1 ring-slate-200">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-t-2xl border-b border-slate-100 bg-white px-5 py-4">
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
    <div className="h-full overflow-y-auto bg-sky-50/40">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-sky-100 bg-white/90 px-6 py-3 shadow-sm backdrop-blur">
        <Link to="/" className="rounded-md p-1.5 text-slate-500 transition-[background-color,color,transform] hover:bg-sky-50 hover:text-slate-950 active:scale-95">
          <ArrowLeft size={16} />
        </Link>
        <h1 className="text-sm font-semibold text-slate-950">{title}</h1>
      </header>
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-6">{children}</main>
    </div>
  );
}
