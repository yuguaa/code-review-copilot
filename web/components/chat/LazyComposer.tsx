import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';

const Composer = lazy(() => import('../composer/Composer').then((module) => ({ default: module.Composer })));

function ComposerFallback() {
  return (
    <div className="flex min-h-[70px] items-center rounded-[var(--r-lg)] border border-[var(--line-default)] bg-[rgba(255,255,255,0.74)] px-4 text-sm text-[var(--muted)] shadow-[0_8px_18px_-14px_rgba(7,26,18,0.38)] backdrop-blur-xl">
      加载输入器…
    </div>
  );
}

export function LazyComposer(props: ComponentProps<typeof Composer>) {
  return (
    <Suspense fallback={<ComposerFallback />}>
      <Composer {...props} />
    </Suspense>
  );
}
