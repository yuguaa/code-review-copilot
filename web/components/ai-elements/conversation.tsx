import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerProvider, MessageScrollerViewport } from '@web/components/ui/message-scroller';
import { cn } from '@web/lib/utils';

import type { ComponentProps } from 'react';

export function Conversation({ className, children, ...props }: ComponentProps<typeof MessageScroller>) {
  return <MessageScrollerProvider autoScroll>
    <MessageScroller data-ai-element="conversation" className={cn('relative flex-1', className)} {...props}>{children}</MessageScroller>
  </MessageScrollerProvider>;
}

export function ConversationContent({ className, ...props }: ComponentProps<typeof MessageScrollerContent>) {
  return <MessageScrollerViewport aria-label="审查对话记录">
    <MessageScrollerContent data-ai-element="conversation-content" className={cn('mx-auto w-full max-w-3xl gap-7 p-5 sm:p-7', className)} {...props} />
  </MessageScrollerViewport>;
}

export function ConversationScrollButton(props: ComponentProps<typeof MessageScrollerButton>) {
  return <MessageScrollerButton variant="outline" className="rounded-full shadow-sm" {...props} />;
}
