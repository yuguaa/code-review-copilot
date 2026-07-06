import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';

const Composer = lazy(() => import('../composer/Composer').then((module) => ({ default: module.Composer })));

function ComposerFallback() {
  return (
    <div className="flex min-h-[70px] items-center rounded-[16px] border border-[rgba(31,39,34,0.1)] bg-white px-4 text-sm text-[var(--muted)] shadow-[0_16px_44px_-34px_rgba(31,39,34,0.42)]">
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
