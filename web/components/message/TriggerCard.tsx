import { useState } from 'react';
import type { UIMessage } from 'ai';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import Webhook from 'lucide-react/dist/esm/icons/webhook';
import { cn } from '../../lib/cn';

function textOf(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('')
    .trim();
}

export function TriggerCard({ message }: { message: UIMessage }) {
  const [open, setOpen] = useState(false);
  const text = textOf(message);
  return (
    <div className="my-3 overflow-hidden rounded-[var(--r-md)] border border-[var(--line-default)] bg-[var(--surface-card)] text-xs text-[var(--ink)] shadow-[var(--shadow-sm)]">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-[background-color,transform] hover:bg-[var(--surface-hover)] active:scale-[0.99]">
        <Webhook size={13} className="shrink-0 text-[var(--ink)]" />
        <span className="eyebrow text-[var(--ink)]">Webhook 触发审查</span>
        <span className="truncate text-[var(--body)]">{open ? '' : text.split('\n')[0]}</span>
        <ChevronRight size={13} className={cn('ml-auto shrink-0 text-[var(--muted-soft)] transition-transform', open && 'rotate-90')} />
      </button>
      {open && <pre className="animate-fade-in whitespace-pre-wrap break-words border-t border-[var(--line-subtle)] bg-[var(--surface-soft)] px-3 py-2.5 font-mono leading-relaxed text-[var(--body)]">{text}</pre>}
    </div>
  );
}
