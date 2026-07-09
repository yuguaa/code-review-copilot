import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

const fieldBase =
  'w-full rounded-[var(--r-sm)] border border-[var(--line-default)] bg-[var(--surface-card)] px-3 py-2.5 text-sm text-[var(--ink)] shadow-[var(--shadow-sm)] outline-none transition-[background-color,border-color,box-shadow] placeholder:text-[var(--muted)] hover:border-[var(--line-strong)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--ring)] disabled:cursor-not-allowed disabled:bg-[var(--surface-soft)] disabled:text-[var(--muted)] disabled:opacity-70';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(fieldBase, props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(fieldBase, 'resize-y', props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(fieldBase, 'cursor-pointer', props.className)} />;
}

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string; error?: string | null }) {
  return (
    <label className="block space-y-1.5">
      <span className="caption text-[var(--body-strong)]">{label}</span>
      {children}
      {error ? (
        <span className="block text-xs leading-relaxed text-[var(--error)]">{error}</span>
      ) : (
        hint && <span className="block text-xs leading-relaxed text-[var(--muted)]">{hint}</span>
      )}
    </label>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--body-strong)]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded-[var(--r-xs)] border border-[var(--line-default)] accent-[var(--brand-magenta)]"
      />
      {label}
    </label>
  );
}
