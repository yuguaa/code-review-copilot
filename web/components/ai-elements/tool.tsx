import { CheckCircleIcon, ChevronDownIcon, CircleIcon, ClockIcon, WrenchIcon, XCircleIcon } from 'lucide-react';

import { Badge } from '@web/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@web/components/ui/collapsible';
import { cn } from '@web/lib/utils';

import type { ComponentProps, ReactNode } from 'react';

const labels: Record<string, string> = {
  'input-streaming': '等待参数', 'input-available': '执行中', 'output-available': '已完成',
  'output-error': '失败', 'approval-requested': '等待确认', 'approval-responded': '已响应', 'output-denied': '已拒绝',
};

function statusIcon(state: string): ReactNode {
  if (state === 'output-available' || state === 'approval-responded') return <CheckCircleIcon />;
  if (state === 'output-error' || state === 'output-denied') return <XCircleIcon />;
  if (state === 'input-available' || state === 'approval-requested') return <ClockIcon />;
  return <CircleIcon />;
}

export function Tool({ className, ...props }: ComponentProps<typeof Collapsible>) {
  return <Collapsible data-ai-element="tool" className={cn('w-full rounded-md border', className)} {...props} />;
}

export function ToolHeader({ className, title, state, ...props }: ComponentProps<typeof CollapsibleTrigger> & { title: string; state: string }) {
  return <CollapsibleTrigger className={cn('flex w-full items-center justify-between gap-4 p-3', className)} {...props}>
    <span className="flex min-w-0 items-center gap-2"><WrenchIcon /><span className="truncate text-sm font-medium">{title}</span>
      <Badge variant="secondary">{statusIcon(state)}{labels[state] ?? state}</Badge></span>
    <ChevronDownIcon className="text-muted-foreground" />
  </CollapsibleTrigger>;
}

export function ToolContent({ className, ...props }: ComponentProps<typeof CollapsibleContent>) {
  return <CollapsibleContent className={cn('border-t', className)} {...props} />;
}

function ToolData({ label, value, destructive }: { label: string; value: unknown; destructive?: boolean }) {
  if (value === undefined) return null;
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return <div className="flex flex-col gap-2 p-3"><span className="text-xs font-medium text-muted-foreground">{label}</span>
    <pre className={cn('max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs leading-5 text-foreground', destructive && 'bg-destructive/10 text-destructive')}>{text}</pre>
  </div>;
}

export function ToolInput({ input }: { input: unknown }) {
  return <ToolData label="输入参数" value={input} />;
}

export function ToolOutput({ output, errorText }: { output: unknown; errorText?: string }) {
  return <ToolData label={errorText ? '错误' : '输出'} value={errorText ?? output} destructive={Boolean(errorText)} />;
}
