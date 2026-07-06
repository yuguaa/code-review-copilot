import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';
import { GlassSurface } from '../ui/glass-surface';

const Composer = lazy(() => import('../composer/Composer').then((module) => ({ default: module.Composer })));

function ComposerFallback() {
  return (
    <GlassSurface className="rounded-[var(--r-lg)] shadow-[var(--shadow-lg)]" contentClassName="flex min-h-[54px] items-center px-4 text-sm text-[var(--muted)]" radius={12}>
      加载输入器…
    </GlassSurface>
  );
}

export function LazyComposer(props: ComponentProps<typeof Composer>) {
  return (
    <Suspense fallback={<ComposerFallback />}>
      <Composer {...props} />
    </Suspense>
  );
}
