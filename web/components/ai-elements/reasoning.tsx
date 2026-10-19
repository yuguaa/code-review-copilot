import { BrainIcon, ChevronDownIcon, Loader2Icon } from 'lucide-react';
import { createContext, useContext, useState } from 'react';

import { MarkdownBlock } from '@web/components/message/MarkdownBlock';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@web/components/ui/collapsible';
import { cn } from '@web/lib/utils';

import type { ComponentProps } from 'react';

const ReasoningContext = createContext<{ open: boolean; streaming: boolean } | null>(null);

export function Reasoning({ className, isStreaming = false, open, defaultOpen = false, onOpenChange, ...props }:
ComponentProps<typeof Collapsible> & { isStreaming?: boolean }) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const currentOpen = open ?? internalOpen;
  const changeOpen: NonNullable<ComponentProps<typeof Collapsible>['onOpenChange']> = (next, details) => {
    if (open === undefined) setInternalOpen(next);
    onOpenChange?.(next, details);
  };
  return <ReasoningContext.Provider value={{ open: Boolean(currentOpen), streaming: isStreaming }}>
    <Collapsible data-ai-element="reasoning" className={cn('mb-3 w-full', className)} open={currentOpen} onOpenChange={changeOpen} {...props} />
  </ReasoningContext.Provider>;
}

export function ReasoningTrigger({ className, ...props }: ComponentProps<typeof CollapsibleTrigger>) {
  const context = useContext(ReasoningContext);
  if (!context) throw new Error('ReasoningTrigger 必须在 Reasoning 内使用');
  return <CollapsibleTrigger className={cn('flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground', className)} {...props}>
    {context.streaming ? <Loader2Icon className="animate-spin" /> : <BrainIcon />}
    <span className={context.streaming ? 'thinking-shimmer' : undefined}>{context.streaming ? '思考中…' : '查看思考过程'}</span>
    <ChevronDownIcon className={cn('transition-transform', context.open && 'rotate-180')} />
  </CollapsibleTrigger>;
}

export function ReasoningContent({ className, children, ...props }: Omit<ComponentProps<typeof CollapsibleContent>, 'children'> & { children: string }) {
  return <CollapsibleContent className={cn('relative mt-2 ml-1 pl-4 text-muted-foreground before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-border', className)} {...props}>
    <MarkdownBlock text={children} />
  </CollapsibleContent>;
}
