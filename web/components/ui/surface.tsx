import type { ReactNode } from 'react';
import { cn } from '@web/lib/utils';
import { Badge } from './badge';
import { Card as CardPrimitive } from './card';

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <CardPrimitive className={cn('px-5', className)}>{children}</CardPrimitive>;
}

/** 指标色条：用图表序列表达不同指标，避免整卡换色破坏信息层级。 */
const TONE_BAR: Record<string, string> = {
  lime: 'bg-chart-4',
  lilac: 'bg-chart-5',
  cream: 'bg-foreground/30',
  mint: 'bg-chart-2',
  pink: 'bg-chart-1',
  coral: 'bg-destructive',
  navy: 'bg-chart-3',
  teal: 'bg-chart-2',
};

export function ColorBlock({
  tone = 'cream',
  className,
  children,
}: {
  tone?: 'lime' | 'lilac' | 'cream' | 'mint' | 'pink' | 'coral' | 'navy' | 'teal';
  className?: string;
  children: ReactNode;
}) {
  return (
    <CardPrimitive className={cn('px-5', className)}>
      <span className={cn('h-0.5 w-8 rounded-full', TONE_BAR[tone])} />
      {children}
    </CardPrimitive>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('text-xs font-medium text-muted-foreground', className)}>{children}</span>;
}

export function BadgePill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Badge variant="secondary" className={cn('h-5 px-2 text-xs', className)}>
      {children}
    </Badge>
  );
}
