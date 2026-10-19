import { MessageScroller as MessageScrollerPrimitive, useMessageScroller, useMessageScrollerScrollable, useMessageScrollerVisibility } from '@shadcn/react/message-scroller';
import { ArrowDownIcon } from 'lucide-react';

import { Button } from '@web/components/ui/button';
import { cn } from '@web/lib/utils';

import type { ComponentProps } from 'react';

/* shadcn base-nova MessageScroller，NeUI c-message-scroller-1 使用的基础组件。 */
export function MessageScrollerProvider(props: ComponentProps<typeof MessageScrollerPrimitive.Provider>) {
  return <MessageScrollerPrimitive.Provider {...props} />;
}

export function MessageScroller({ className, ...props }: ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  return <MessageScrollerPrimitive.Root data-slot="message-scroller" className={cn('group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden', className)} {...props} />;
}

export function MessageScrollerViewport({ className, ...props }: ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  return <MessageScrollerPrimitive.Viewport data-slot="message-scroller-viewport" className={cn('size-full min-h-0 min-w-0 scroll-fade-b scrollbar-thin scrollbar-gutter-stable overflow-y-auto overscroll-contain contain-content data-autoscrolling:scrollbar-thumb-transparent data-autoscrolling:scrollbar-track-transparent data-pending-scroll:invisible', className)} {...props} />;
}

export function MessageScrollerContent({ className, ...props }: ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return <MessageScrollerPrimitive.Content data-slot="message-scroller-content" className={cn('flex h-max min-h-full flex-col gap-6', className)} {...props} />;
}

export function MessageScrollerItem({ className, scrollAnchor = false, ...props }: ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  return <MessageScrollerPrimitive.Item data-slot="message-scroller-item" scrollAnchor={scrollAnchor} className={cn('min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem] [content-visibility:auto]', className)} {...props} />;
}

export function MessageScrollerButton({ direction = 'end', className, children, render, variant = 'secondary', size = 'icon-sm', ...props }: ComponentProps<typeof MessageScrollerPrimitive.Button> & Pick<ComponentProps<typeof Button>, 'variant' | 'size'>) {
  return <MessageScrollerPrimitive.Button data-slot="message-scroller-button" data-direction={direction} data-variant={variant} data-size={size} direction={direction} className={cn('absolute inset-s-1/2 -translate-x-1/2 border-border bg-background text-foreground transition-[translate,scale,opacity] duration-200 hover:bg-muted hover:text-foreground data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=false]:duration-400 data-[active=false]:ease-[cubic-bezier(0.7,0,0.84,0)] data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[active=true]:ease-[cubic-bezier(0.23,1,0.32,1)] data-[direction=end]:bottom-4 data-[direction=end]:data-[active=false]:translate-y-full data-[direction=start]:top-4 data-[direction=start]:data-[active=false]:-translate-y-full rtl:translate-x-1/2 data-[direction=start]:[&_svg]:rotate-180', className)} render={render ?? <Button variant={variant} size={size} />} {...props}>{children ?? <><ArrowDownIcon /><span className="sr-only">{direction === 'end' ? '滚动到最新消息' : '滚动到最早消息'}</span></>}</MessageScrollerPrimitive.Button>;
}

export { useMessageScroller, useMessageScrollerScrollable, useMessageScrollerVisibility };
