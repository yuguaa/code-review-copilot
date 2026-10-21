import type { ReactNode } from 'react';
import { cn } from '@web/lib/utils';
import { ShellHeader } from '../layout/shell-header';
import { ScrollArea } from './scroll-area';

/** 业务页面容器：统一顶栏与内容滚动区。 */
export function PageShell({
  title,
  children,
  maxWidth = 'max-w-5xl',
}: {
  title: string;
  children: ReactNode;
  maxWidth?: string;
}) {
  return (
    <>
      <ShellHeader title={title} />
      <ScrollArea className="min-h-0 flex-1">
        <div className={cn('mx-auto w-full space-y-5 p-3 sm:p-4', maxWidth)}>{children}</div>
      </ScrollArea>
    </>
  );
}
