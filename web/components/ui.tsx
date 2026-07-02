import { useState, type ReactNode, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes, type ButtonHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, X, TriangleAlert } from 'lucide-react';
import { cn } from '../lib/cn';

const fieldBase =
  'w-full rounded-[var(--r-md)] border border-[var(--hairline)] bg-white px-4 py-2.5 text-sm text-[var(--ink)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--muted-soft)] focus:border-[var(--ink)] focus:ring-4 focus:ring-[var(--ring)] disabled:bg-[var(--surface-card)] disabled:opacity-60';

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
      <span className="text-xs font-semibold text-[var(--body-strong)]">{label}</span>
      {children}
      {hint && <span className="block text-xs leading-relaxed text-[var(--muted)]">{hint}</span>}
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
        className="h-4 w-4 rounded-[var(--r-xs)] accent-[var(--brand-pink)]"
      />
      {label}
    </label>
  );
}

/** 小标签：section 上方的 uppercase 提示 / FEATURED 徽标。 */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]', className)}>
      {children}
    </span>
  );
}

/** 奶油胶囊徽标。 */
export function BadgePill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-[var(--surface-card)] px-2.5 py-1 text-[13px] font-medium text-[var(--body-strong)]',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'onColor' | 'danger' }) {
  const styles = {
    primary: 'bg-[var(--primary)] text-[var(--on-primary)] hover:opacity-90',
    secondary: 'border border-[var(--hairline)] bg-[var(--canvas)] text-[var(--ink)] hover:bg-[var(--surface-card)]',
    onColor: 'bg-white text-[var(--ink)] hover:opacity-90',
    danger: 'border border-[var(--error)]/30 bg-white text-[var(--error)] hover:bg-[var(--error)]/8',
  }[variant];
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-[var(--r-md)] px-5 py-2.5 text-sm font-semibold transition-[background-color,opacity,transform] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45',
        styles,
        className,
      )}
    />
  );
}

/** 内容卡：奶油底，rounded-lg，无重阴影。 */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-[var(--r-lg)] border border-[var(--hairline)] bg-white p-6', className)}>{children}</div>
  );
}

/** 饱和 6 色特征卡。文字色按底色深浅自动切换。 */
const FEATURE_SURFACE: Record<string, { bg: string; dark: boolean }> = {
  pink: { bg: 'var(--brand-pink)', dark: true },
  teal: { bg: 'var(--brand-teal)', dark: true },
  lavender: { bg: 'var(--brand-lavender)', dark: false },
  peach: { bg: 'var(--brand-peach)', dark: false },
  ochre: { bg: 'var(--brand-ochre)', dark: false },
  cream: { bg: 'var(--surface-card)', dark: false },
};

export function FeatureCard({
  tone = 'cream',
  className,
  children,
}: {
  tone?: 'pink' | 'teal' | 'lavender' | 'peach' | 'ochre' | 'cream';
  className?: string;
  children: ReactNode;
}) {
  const surface = FEATURE_SURFACE[tone];
  return (
    <div
      className={cn('rounded-[var(--r-xl)] p-8', surface.dark ? 'text-white' : 'text-[var(--ink)]', className)}
      style={{ backgroundColor: surface.bg }}
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
  maxWidth = 'max-w-3xl',
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  maxWidth?: string;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[var(--surface-dark)]/40 px-4 py-10"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={cn('animate-fade-in w-full rounded-[var(--r-lg)] bg-[var(--canvas)] shadow-[var(--shadow-lg)]', maxWidth)}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-t-[var(--r-lg)] border-b border-[var(--hairline)] bg-[var(--canvas)] px-6 py-4">
          <h2 className="font-display text-lg text-[var(--ink)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭弹窗"
            className="flex h-8 w-8 items-center justify-center rounded-[var(--r-md)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-card)] hover:text-[var(--ink)]"
          >
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[calc(100vh-11rem)] overflow-y-auto px-6 py-6">{children}</div>
      </div>
    </div>
  );
}

/** 危险操作确认弹层：替代 window.confirm，删除类操作统一走这里。 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '删除',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--surface-dark)]/40 px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="animate-fade-in w-full max-w-sm rounded-[var(--r-lg)] bg-[var(--canvas)] p-6 shadow-[var(--shadow-lg)]">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--r-md)] bg-[var(--brand-coral)]/15 text-[var(--brand-coral)]">
            <TriangleAlert size={18} />
          </span>
          <div className="min-w-0 space-y-1">
            <h2 className="font-display text-base text-[var(--ink)]">{title}</h2>
            <p className="text-sm leading-relaxed text-[var(--muted)]">{description}</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} type="button" autoFocus>
            取消
          </Button>
          <Button
            onClick={onConfirm}
            type="button"
            className="border-transparent bg-[var(--brand-coral)] text-white hover:opacity-90"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** useConfirm：命令式打开确认弹层，resolve 用户的选择。 */
export function useConfirm() {
  const [state, setState] = useState<{
    title: string;
    description: string;
    confirmLabel?: string;
    resolve: (ok: boolean) => void;
  } | null>(null);

  const confirm = (opts: { title: string; description: string; confirmLabel?: string }) =>
    new Promise<boolean>((resolve) => setState({ ...opts, resolve }));

  const element = state ? (
    <ConfirmDialog
      open
      title={state.title}
      description={state.description}
      confirmLabel={state.confirmLabel}
      onConfirm={() => {
        state.resolve(true);
        setState(null);
      }}
      onCancel={() => {
        state.resolve(false);
        setState(null);
      }}
    />
  ) : null;

  return { confirm, element };
}

export function PageShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto bg-[var(--canvas)]">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--hairline)] bg-[var(--canvas)]/95 px-6 py-4 backdrop-blur-sm">
        <Link
          to="/"
          aria-label="返回"
          className="flex h-9 w-9 items-center justify-center rounded-[var(--r-md)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-card)] hover:text-[var(--ink)]"
        >
          <ArrowLeft size={16} />
        </Link>
        <h1 className="font-display text-lg text-[var(--ink)]">{title}</h1>
      </header>
      <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">{children}</main>
    </div>
  );
}
