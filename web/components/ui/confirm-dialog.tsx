import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import TriangleAlert from 'lucide-react/dist/esm/icons/triangle-alert';
import { Button } from './button';

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
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel, open]);

  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto overscroll-contain bg-[var(--surface-dark)]/42 px-4 py-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="tech-panel animate-fade-in w-full max-w-[420px] rounded-[var(--r-lg)] bg-[var(--surface-card)] p-5 shadow-[var(--shadow-popover)] sm:p-6"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--r-sm)] bg-[var(--brand-coral)]/12 text-[var(--brand-coral)]">
            <TriangleAlert size={18} />
          </span>
          <div className="min-w-0 space-y-1">
            <h2 id={titleId} className="font-display text-base text-[var(--ink)]">
              {title}
            </h2>
            <p id={descriptionId} className="text-sm leading-relaxed text-[var(--muted)]">
              {description}
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel} type="button" autoFocus>
            取消
          </Button>
          <Button
            onClick={onConfirm}
            type="button"
            className="border-transparent bg-[var(--brand-coral)] text-white hover:bg-[var(--brand-coral)] hover:brightness-95"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

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
