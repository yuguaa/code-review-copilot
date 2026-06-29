import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ButtonHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
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
    primary: 'bg-slate-950 text-white shadow-sm hover:bg-slate-800',
    ghost: 'border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50',
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
  return <div className={cn('rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70', className)}>{children}</div>;
}

export function PageShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white/85 px-6 py-3 shadow-sm backdrop-blur">
        <Link to="/" className="rounded-md p-1.5 text-slate-500 transition-[background-color,color,transform] hover:bg-slate-100 hover:text-slate-950 active:scale-95">
          <ArrowLeft size={16} />
        </Link>
        <h1 className="text-sm font-semibold text-slate-950">{title}</h1>
      </header>
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-6">{children}</main>
    </div>
  );
}
