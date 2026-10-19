import type { ReactNode } from 'react';

/** 主区顶栏：左侧当前对象，右侧页面操作。 */
export function ShellHeader({
  title,
  meta,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="relative z-10 flex min-h-[76px] shrink-0 flex-wrap items-center gap-3 border-b border-border/70 bg-background/65 px-5 py-4 backdrop-blur-sm sm:px-7">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h1 className="truncate text-lg font-semibold tracking-[-0.02em]">{title}</h1>
        {meta ? <span className="truncate text-xs leading-5 text-muted-foreground">{meta}</span> : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </header>
  );
}
