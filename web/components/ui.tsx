import { useState, type ReactNode, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes, type ButtonHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, X, TriangleAlert } from 'lucide-react';
import { cn } from '../lib/cn';

const fieldBase =
  'w-full rounded-[var(--r-sm)] border border-[var(--hairline)] bg-white px-3 py-2.5 text-sm text-[var(--ink)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--muted)] focus:border-[var(--ink)] focus:shadow-[0_0_0_1px_rgba(0,0,0,0.08)] disabled:bg-[var(--surface-card)] disabled:opacity-60';

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
      <span className="eyebrow text-[var(--body-strong)]">{label}</span>
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
        className="h-4 w-4 rounded-[var(--r-xs)] accent-[var(--ink)]"
      />
      {label}
    </label>
  );
}

/** 小标签：section 上方的 uppercase taxonomy。 */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('eyebrow text-[var(--muted)]', className)}>{children}</span>;
}

/** 胶囊徽标。 */
export function BadgePill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--r-pill)] bg-[var(--surface-card)] px-2.5 py-1 text-[13px] font-medium text-[var(--body-strong)]',
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

/** 内容卡：只用于真正需要框定的内容块。 */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-[var(--r-md)] border border-[var(--hairline)] bg-white p-6 shadow-[var(--shadow-sm)]', className)}>{children}</div>
  );
}

const COLOR_BLOCK_SURFACE: Record<string, { bg: string; dark: boolean }> = {
  lime: { bg: 'var(--brand-lime)', dark: false },
  lilac: { bg: 'var(--brand-lilac)', dark: false },
  cream: { bg: 'var(--brand-cream)', dark: false },
  mint: { bg: 'var(--brand-mint)', dark: false },
  pink: { bg: 'var(--brand-pink)', dark: false },
  coral: { bg: 'var(--brand-coral)', dark: true },
  navy: { bg: 'var(--brand-navy)', dark: true },
  teal: { bg: 'var(--brand-teal)', dark: true },
};

export function ColorBlock({
  tone = 'cream',
  className,
  children,
}: {
  tone?: 'lime' | 'lilac' | 'cream' | 'mint' | 'pink' | 'coral' | 'navy' | 'teal';
  className?: string;
  children: ReactNode;
}) {
  const surface = COLOR_BLOCK_SURFACE[tone];
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
      <div className={cn('animate-fade-in w-full rounded-[var(--r-md)] bg-[var(--canvas)] shadow-[var(--shadow-lg)]', maxWidth)}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-t-[var(--r-md)] border-b border-[var(--hairline)] bg-[var(--canvas)] px-6 py-4">
          <h2 className="font-display text-lg text-[var(--ink)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭弹窗"
            className="flex h-8 w-8 items-center justify-center rounded-[var(--r-pill)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-card)] hover:text-[var(--ink)]"
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
      <div className="animate-fade-in w-full max-w-sm rounded-[var(--r-md)] bg-[var(--canvas)] p-6 shadow-[var(--shadow-lg)]">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--r-pill)] bg-[var(--brand-coral)]/15 text-[var(--brand-coral)]">
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

export function PageShell({
  title,
  children,
  maxWidth = 'max-w-5xl',
}: {
  title: string;
  children: ReactNode;
  maxWidth?: string;
}) {
  return (
    <div className="h-full overflow-y-auto bg-[var(--canvas)]">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--hairline)] bg-[var(--canvas)] px-6 py-4">
        <Link
          to="/"
          aria-label="返回"
          className="flex h-9 w-9 items-center justify-center rounded-[var(--r-pill)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-card)] hover:text-[var(--ink)]"
        >
          <ArrowLeft size={16} />
        </Link>
        <h1 className="font-display text-lg text-[var(--ink)]">{title}</h1>
      </header>
      <main className={cn('mx-auto space-y-8 px-6 py-10', maxWidth)}>{children}</main>
    </div>
  );
}
