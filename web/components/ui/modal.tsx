import type { ReactNode } from 'react';
import X from 'lucide-react/dist/esm/icons/x';
import { cn } from '../../lib/cn';

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
