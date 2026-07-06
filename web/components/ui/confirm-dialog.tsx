import { useState } from 'react';
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
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--surface-dark)]/40 px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="tech-panel animate-fade-in w-full max-w-sm rounded-[var(--r-lg)] bg-[var(--canvas)] p-6">
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
