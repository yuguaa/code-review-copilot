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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[var(--surface-dark)]/48 px-4 py-10 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={cn('tech-panel animate-fade-in w-full overflow-hidden rounded-[var(--r-lg)] shadow-[var(--shadow-lg)]', maxWidth)}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-t-[var(--r-lg)] border-b border-[var(--line-default)] bg-[rgba(251,252,248,0.94)] px-6 py-4 backdrop-blur">
          <h2 className="font-display text-lg text-[var(--ink)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭弹窗"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-[var(--r-md)] border border-transparent text-[var(--muted)] transition-[background-color,border-color,color,transform] hover:border-[var(--line-default)] hover:bg-[var(--surface-soft)] hover:text-[var(--ink)] active:scale-95"
          >
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[calc(100vh-11rem)] overflow-y-auto px-6 py-6">{children}</div>
      </div>
    </div>
  );
}
