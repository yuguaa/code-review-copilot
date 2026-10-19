import { createContext, useContext, useState } from 'react';
import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';

import { cn } from '@web/lib/utils';

/* 来源：NeUI registry，base-nova/timeline。 */
const TimelineContext = createContext(1);

export function Timeline({ defaultValue = 1, value, onValueChange, orientation = 'vertical', className, render, children, ...props }: useRender.ComponentProps<'div'> & {
  defaultValue?: number; value?: number; onValueChange?: (value: number) => void; orientation?: 'horizontal' | 'vertical';
}) {
  const [activeStep] = useState(defaultValue);
  const defaultProps = {
    className: cn('group/timeline flex data-[orientation=horizontal]:flex-row data-[orientation=vertical]:flex-col', className),
    'data-orientation': orientation, 'data-slot': 'timeline', children,
  };
  return <TimelineContext.Provider value={value ?? activeStep}>{useRender({ defaultTagName: 'div', render, props: mergeProps<'div'>(defaultProps, props) })}</TimelineContext.Provider>;
}

export function TimelineItem({ step, className, render, children, ...props }: useRender.ComponentProps<'div'> & { step: number }) {
  const activeStep = useContext(TimelineContext);
  const defaultProps = {
    className: cn('group/timeline-item relative flex flex-1 flex-col gap-0.5 group-data-[orientation=vertical]/timeline:ms-8 group-data-[orientation=vertical]/timeline:not-last:pb-6', className),
    'data-completed': step <= activeStep || undefined, 'data-slot': 'timeline-item', children,
  };
  return useRender({ defaultTagName: 'div', render, props: mergeProps<'div'>(defaultProps, props) });
}

export function TimelineIndicator({ className, render, children, ...props }: useRender.ComponentProps<'div'>) {
  const defaultProps = {
    'aria-hidden': true as const, className: cn('absolute -left-6 top-0 size-4 -translate-x-1/2 rounded-full border-2 border-primary/20 group-data-completed/timeline-item:border-primary', className),
    'data-slot': 'timeline-indicator', children,
  };
  return useRender({ defaultTagName: 'div', render, props: mergeProps<'div'>(defaultProps, props) });
}

export function TimelineSeparator({ className, render, ...props }: useRender.ComponentProps<'div'>) {
  const defaultProps = {
    'aria-hidden': true as const, className: cn('absolute -left-6 h-[calc(100%-1rem-0.25rem)] w-0.5 -translate-x-1/2 translate-y-4.5 self-start bg-primary/10 group-last/timeline-item:hidden', className),
    'data-slot': 'timeline-separator',
  };
  return useRender({ defaultTagName: 'div', render, props: mergeProps<'div'>(defaultProps, props) });
}
