import { useState } from 'react';
import type { UIMessage } from 'ai';
import { Streamdown } from 'streamdown';
import { code } from '@streamdown/code';
import { cjk } from '@streamdown/cjk';
import { Brain, ChevronRight, CircleCheck, CircleDashed, CircleX, Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { StreamingCursor } from './StreamingCursor';
import { isBoundaryPart, type MessagePart } from './message-types';

const TOOL_LABEL: Record<string, string> = {
  bash: '执行命令',
  read_file: '读取文件',
  git_diff: '查看变更 diff',
  read_memory: '读取项目记忆',
  write_memory: '更新项目记忆',
  post_review_comment: '发布审查评论',
  post_inline_comment: '发布行级评论',
  delegate_security: '委派安全审查',
  delegate_architecture: '委派架构审查',
  delegate_performance: '委派性能审查',
};

function toolName(part: Record<string, unknown>): string {
  const type = String(part.type ?? '');
  const raw = type === 'dynamic-tool' ? String(part.toolName ?? '') : type.replace(/^tool-/, '');
  return TOOL_LABEL[raw] ?? raw;
}

function isTool(part: MessagePart): boolean {
  return part.type === 'dynamic-tool' || part.type.startsWith('tool-');
}

function MarkdownBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  if (!text.trim() && !streaming) return null;
  return (
    <div className="streamdown-body min-w-0">
      {text.trim() ? (
        <Streamdown animated plugins={{ code, cjk }} isAnimating={Boolean(streaming)}>
          {text}
        </Streamdown>
      ) : null}
      {streaming && <StreamingCursor />}
    </div>
  );
}

function PlainTextBlock({ text }: { text: string }) {
  if (!text.trim()) return null;
  return <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{text}</p>;
}

function ReasoningBlock({ part }: { part: MessagePart }) {
  const [open, setOpen] = useState(false);
  const record = part as unknown as Record<string, unknown>;
  const text = String(record.text ?? '');
  const streaming = record.state === 'streaming';
  if (!text.trim() && !streaming) return null;
  return (
    <div className="overflow-hidden rounded-[var(--r-md)] border border-[var(--hairline)] bg-white text-xs shadow-[var(--shadow-sm)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[var(--body-strong)] transition-colors hover:bg-[var(--surface-hover)]"
      >
        {streaming ? <Loader2 size={13} className="shrink-0 animate-spin text-[var(--warning)]" /> : <Brain size={13} className="shrink-0 text-[var(--muted)]" />}
        <span className="caption truncate">REASONING{text && !open ? ` · ${text.slice(0, 72)}` : ''}</span>
        <ChevronRight size={12} className={cn('ml-auto shrink-0 text-[var(--muted-soft)] transition-transform', open && 'rotate-90')} />
      </button>
      {open && <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words border-t border-[var(--hairline)] px-3 py-2.5 text-[var(--muted)]">{text}</pre>}
    </div>
  );
}

function JsonPanel({ label, value, strong }: { label: string; value: unknown; strong?: boolean }) {
  return (
    <div className="space-y-1">
      <span className="caption text-[var(--muted-soft)]">{label}</span>
      <pre
        className={cn(
          'max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[var(--r-sm)] bg-[var(--surface-soft)] px-2.5 py-2 font-mono text-[11px] leading-relaxed ring-1 ring-[var(--hairline)]',
          strong ? 'text-[var(--body-strong)]' : 'text-[var(--body)]',
        )}
      >
        {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function ToolBlock({ part }: { part: MessagePart }) {
  const [open, setOpen] = useState(false);
  const record = part as unknown as Record<string, unknown>;
  const state = String(record.state ?? '');
  const done = state === 'output-available';
  const errored = state === 'output-error';
  const running = !done && !errored;
  const StatusIcon = errored ? CircleX : done ? CircleCheck : Loader2;
  return (
    <div className="overflow-hidden rounded-[var(--r-md)] border border-[var(--hairline)] bg-white text-xs shadow-[var(--shadow-sm)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--surface-soft)]"
      >
        <StatusIcon
          size={13}
          className={cn('shrink-0', errored ? 'text-[var(--error)]' : done ? 'text-[var(--success)]' : 'animate-spin text-[var(--warning)]')}
        />
        <span className={cn('caption truncate', errored ? 'text-[var(--error)]' : 'text-[var(--body-strong)]')}>{toolName(record)}</span>
        {running && <span className="shrink-0 text-[var(--muted-soft)]">执行中</span>}
        <ChevronRight size={12} className={cn('ml-auto shrink-0 text-[var(--muted-soft)] transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-[var(--hairline)] bg-[var(--canvas)] px-3 py-2.5">
          {record.input != null && <JsonPanel label="INPUT" value={record.input} />}
          {record.output != null && <JsonPanel label="OUTPUT" value={record.output} strong />}
          {errored && record.errorText != null && <pre className="whitespace-pre-wrap break-words text-[11px] text-[var(--error)]">{String(record.errorText)}</pre>}
        </div>
      )}
    </div>
  );
}

function UnknownBlock({ part }: { part: MessagePart }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-[var(--r-md)] border border-[var(--hairline)] bg-[var(--surface-soft)] text-xs">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[var(--muted)] hover:bg-[var(--surface-hover)]">
        <CircleDashed size={13} className="shrink-0" />
        <span className="caption truncate">{String(part.type)}</span>
        <ChevronRight size={12} className={cn('ml-auto shrink-0 transition-transform', open && 'rotate-90')} />
      </button>
      {open && <JsonPanel label="PART" value={part} />}
    </div>
  );
}

export function MessageBlockRenderer({ part, role, streaming }: { part: MessagePart; role: UIMessage['role']; streaming?: boolean }) {
  if (isBoundaryPart(part)) return null;
  if (part.type === 'text') {
    return role === 'assistant' ? <MarkdownBlock text={part.text} streaming={streaming || (part as { state?: string }).state === 'streaming'} /> : <PlainTextBlock text={part.text} />;
  }
  if (part.type === 'reasoning') return <ReasoningBlock part={part} />;
  if (isTool(part)) return <ToolBlock part={part} />;
  return <UnknownBlock part={part} />;
}
