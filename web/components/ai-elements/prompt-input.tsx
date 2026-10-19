import { Button } from '@web/components/ui/button';
import { Textarea } from '@web/components/ui/forms';
import { cn } from '@web/lib/utils';

import type { ComponentProps } from 'react';

export function PromptInput({ className, ...props }: ComponentProps<'form'>) {
  return <form data-ai-element="prompt-input" className={cn('rounded-lg border bg-background shadow-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50', className)} {...props} />;
}

export function PromptInputBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-1', className)} {...props} />;
}

export function PromptInputTextarea({ className, ...props }: ComponentProps<typeof Textarea>) {
  return <Textarea className={cn('min-h-20 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0', className)} {...props} />;
}

export function PromptInputFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-wrap items-center gap-3 border-t px-2 py-2', className)} {...props} />;
}

export function PromptInputTools({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex min-w-0 flex-1 items-center gap-3', className)} {...props} />;
}

export function PromptInputSubmit(props: ComponentProps<typeof Button>) {
  return <Button type="submit" size="sm" {...props} />;
}
