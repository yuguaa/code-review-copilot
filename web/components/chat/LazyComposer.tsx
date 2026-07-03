import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';

const Composer = lazy(() => import('../composer/Composer').then((module) => ({ default: module.Composer })));

function ComposerFallback() {
  return (
    <div className="flex min-h-[54px] items-center rounded-[var(--r-lg)] border border-[var(--hairline)] bg-white px-4 text-sm text-[var(--muted)] shadow-[var(--shadow-sm)]">
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
