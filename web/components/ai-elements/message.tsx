import { Button } from '@web/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@web/components/ui/tooltip';
import { MarkdownBlock } from '@web/components/message/MarkdownBlock';
import { cn } from '@web/lib/utils';

import type { UIMessage } from 'ai';
import type { ComponentProps, HTMLAttributes } from 'react';

export function Message({ className, from, ...props }: HTMLAttributes<HTMLDivElement> & { from: UIMessage['role'] }) {
  return <div data-ai-element="message" className={cn('group flex w-full max-w-[95%] flex-col gap-2',
    from === 'user' ? 'is-user ml-auto items-end' : 'is-assistant', className)} {...props} />;
}

export function MessageContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-ai-element="message-content" className={cn('flex max-w-full min-w-0 flex-col gap-2 text-sm group-[.is-user]:w-fit group-[.is-user]:rounded-lg group-[.is-user]:bg-muted group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-assistant]:w-full', className)} {...props} />;
}

export function MessageResponse({ children, streaming }: { children: string; streaming?: boolean }) {
  return <MarkdownBlock text={children} streaming={streaming} />;
}

export function MessageActions({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex items-center gap-1 text-muted-foreground', className)} {...props} />;
}

export function MessageAction({ tooltip, label, children, ...props }: ComponentProps<typeof Button> & { tooltip?: string; label?: string }) {
  const button = <Button type="button" variant="ghost" size="xs" aria-label={label ?? tooltip} {...props}>{children}</Button>;
  if (!tooltip) return button;
  return <TooltipProvider><Tooltip><TooltipTrigger render={button} /><TooltipContent>{tooltip}</TooltipContent></Tooltip></TooltipProvider>;
}
