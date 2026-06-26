import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ButtonHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../lib/cn';

const fieldBase =
  'w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-600 disabled:opacity-50';

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
      <span className="text-xs font-medium text-neutral-400">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-neutral-600">{hint}</span>}
    </label>
  );
}

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-white text-black hover:bg-neutral-200',
    ghost: 'border border-neutral-800 text-neutral-200 hover:bg-neutral-900',
    danger: 'border border-rose-900 text-rose-300 hover:bg-rose-950/40',
  }[variant];
  return (
    <button
      {...props}
      className={cn(
        'rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-40',
        styles,
        className,
      )}
    />
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-xl border border-neutral-800 bg-neutral-900/40 p-5', className)}>{children}</div>;
}

export function PageShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-neutral-800 bg-neutral-950/80 px-6 py-3 backdrop-blur">
        <Link to="/" className="rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-100">
          <ArrowLeft size={16} />
        </Link>
        <h1 className="text-sm font-semibold">{title}</h1>
      </header>
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-6">{children}</main>
    </div>
  );
}
