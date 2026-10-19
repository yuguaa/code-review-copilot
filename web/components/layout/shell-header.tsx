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
    <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b px-5 py-3 sm:px-7">
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="truncate text-sm font-medium">{title}</h1>
        {meta ? <span className="truncate text-xs text-muted-foreground">{meta}</span> : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-1.5">{children}</div> : null}
    </header>
  );
}
