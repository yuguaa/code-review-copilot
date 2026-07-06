import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';

const Composer = lazy(() => import('../composer/Composer').then((module) => ({ default: module.Composer })));

function ComposerFallback() {
  return (
    <div className="flex min-h-[70px] items-center rounded-[16px] border border-[var(--line-default)] bg-[rgba(255,255,255,0.86)] px-4 text-sm text-[var(--muted)] shadow-[0_18px_52px_-30px_rgba(7,26,18,0.48)] backdrop-blur-xl">
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
