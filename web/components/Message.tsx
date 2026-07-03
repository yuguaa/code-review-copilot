import { useState } from 'react';
import type { UIMessage } from 'ai';
import { Streamdown } from 'streamdown';
import { code } from '@streamdown/code';
import { cjk } from '@streamdown/cjk';
import { Brain, ChevronLeft, ChevronRight, CircleCheck, CircleDashed, CircleX, GitBranchPlus, Loader2, RotateCcw, Webhook } from 'lucide-react';
import { cn } from '../lib/cn';
import type { MessageTreeNode } from '../lib/types';

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

type Part = UIMessage['parts'][number];
type BranchInfo = Pick<MessageTreeNode, 'siblingIds' | 'siblingIndex' | 'siblingCount'>;

function textOf(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('')
    .trim();
}

function toolName(part: Record<string, unknown>): string {
  const type = String(part.type ?? '');
  const raw = type === 'dynamic-tool' ? String(part.toolName ?? '') : type.replace(/^tool-/, '');
  return TOOL_LABEL[raw] ?? raw;
}

function isTool(part: Part): boolean {
  return part.type === 'dynamic-tool' || part.type.startsWith('tool-');
}

function isBoundary(part: Part): boolean {
  const type = String(part.type);
  return type === 'step-start' || type === 'step-finish';
}

function StreamingCursor({ className }: { className?: string }) {
  return <span className={cn('inline-block h-4 w-1.5 translate-y-0.5 animate-pulse rounded-full bg-[var(--ink)]', className)} />;
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

function ReasoningBlock({ part }: { part: Part }) {
  const [open, setOpen] = useState(false);
  const record = part as unknown as Record<string, unknown>;
  const text = String(record.text ?? '');
  const streaming = record.state === 'streaming';
  if (!text.trim() && !streaming) return null;
  return (
    <div className="overflow-hidden rounded-[var(--r-md)] border border-[var(--hairline)] bg-[var(--surface-soft)] text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[var(--body-strong)] transition-colors hover:bg-white"
      >
        {streaming ? <Loader2 size={13} className="shrink-0 animate-spin text-[var(--warning)]" /> : <Brain size={13} className="shrink-0 text-[var(--brand-navy)]" />}
        <span className="caption truncate">REASONING{text && !open ? ` · ${text.slice(0, 72)}` : ''}</span>
        <ChevronRight size={12} className={cn('ml-auto shrink-0 text-[var(--muted-soft)] transition-transform', open && 'rotate-90')} />
      </button>
      {open && <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words border-t border-[var(--hairline)] px-3 py-2.5 text-[var(--muted)]">{text}</pre>}
    </div>
  );
}

function ToolBlock({ part }: { part: Part }) {
  const [open, setOpen] = useState(false);
  const record = part as unknown as Record<string, unknown>;
  const state = String(record.state ?? '');
  const done = state === 'output-available';
  const errored = state === 'output-error';
  const running = !done && !errored;
  const StatusIcon = errored ? CircleX : done ? CircleCheck : Loader2;
  return (
    <div className="overflow-hidden rounded-[var(--r-md)] border border-[var(--hairline)] bg-white text-xs">
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

function UnknownBlock({ part }: { part: Part }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-[var(--r-md)] border border-[var(--hairline)] bg-[var(--surface-soft)] text-xs">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[var(--muted)] hover:bg-white">
        <CircleDashed size={13} className="shrink-0" />
        <span className="caption truncate">{String(part.type)}</span>
        <ChevronRight size={12} className={cn('ml-auto shrink-0 transition-transform', open && 'rotate-90')} />
      </button>
      {open && <JsonPanel label="PART" value={part} />}
    </div>
  );
}

function MessageBlockRenderer({ part, role, streaming }: { part: Part; role: UIMessage['role']; streaming?: boolean }) {
  if (isBoundary(part)) return null;
  if (part.type === 'text') {
    return role === 'assistant' ? <MarkdownBlock text={part.text} streaming={streaming || (part as { state?: string }).state === 'streaming'} /> : <PlainTextBlock text={part.text} />;
  }
  if (part.type === 'reasoning') return <ReasoningBlock part={part} />;
  if (isTool(part)) return <ToolBlock part={part} />;
  return <UnknownBlock part={part} />;
}

function TriggerCard({ message }: { message: UIMessage }) {
  const [open, setOpen] = useState(false);
  const text = textOf(message);
  return (
    <div className="my-3 overflow-hidden rounded-[var(--r-md)] border border-[var(--hairline)] bg-[var(--brand-lime)] text-xs text-[var(--ink)]">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-black/5">
        <Webhook size={13} className="shrink-0 text-[var(--ink)]" />
        <span className="eyebrow text-[var(--ink)]">Webhook 触发审查</span>
        <span className="truncate text-[var(--body)]">{open ? '' : text.split('\n')[0]}</span>
        <ChevronRight size={13} className={cn('ml-auto shrink-0 text-[var(--muted-soft)] transition-transform', open && 'rotate-90')} />
      </button>
      {open && <pre className="animate-fade-in whitespace-pre-wrap break-words border-t border-black/15 bg-white/50 px-3 py-2.5 font-mono leading-relaxed text-[var(--body)]">{text}</pre>}
    </div>
  );
}

function BranchSwitcher({ branch, onSelectSibling }: { branch?: BranchInfo; onSelectSibling?: (messageId: string) => void }) {
  if (!branch || branch.siblingCount <= 1 || !onSelectSibling) return null;
  const previous = branch.siblingIds[branch.siblingIndex - 1];
  const next = branch.siblingIds[branch.siblingIndex + 1];
  return (
    <div className="caption flex shrink-0 items-center gap-1 rounded-[var(--r-pill)] bg-[var(--surface-card)] px-1.5 py-1 text-[var(--body-strong)]">
      <button type="button" disabled={!previous} onClick={() => previous && onSelectSibling(previous)} className="rounded-[var(--r-pill)] p-0.5 hover:bg-white disabled:opacity-30" aria-label="上一条分支">
        <ChevronLeft size={12} />
      </button>
      <span className="min-w-8 text-center">{branch.siblingIndex + 1}/{branch.siblingCount}</span>
      <button type="button" disabled={!next} onClick={() => next && onSelectSibling(next)} className="rounded-[var(--r-pill)] p-0.5 hover:bg-white disabled:opacity-30" aria-label="下一条分支">
        <ChevronRight size={12} />
      </button>
    </div>
  );
}

export function Message({
  message,
  isTrigger,
  isStreaming,
  branch,
  onSelectSibling,
  onBranchFrom,
}: {
  message: UIMessage;
  isTrigger?: boolean;
  isStreaming?: boolean;
  branch?: BranchInfo;
  onSelectSibling?: (messageId: string) => void;
  onBranchFrom?: (messageId: string) => void;
}) {
  if (isTrigger) return <TriggerCard message={message} />;

  const isUser = message.role === 'user';
  const visibleParts = message.parts.filter((part) => !isBoundary(part));
  const canBranch = !isStreaming && Boolean(onBranchFrom);
  return (
    <div className={cn('group flex py-3', isUser ? 'justify-end pl-12' : 'justify-start pr-8 max-md:pr-0')}>
      <div className={cn('flex max-w-full items-start gap-2', isUser && 'flex-row-reverse')}>
        <div
          className={cn(
            'min-w-0 space-y-3 rounded-[var(--r-md)]',
            isUser ? 'bg-[var(--ink)] px-4 py-2.5 text-white' : 'bg-transparent text-[var(--body-strong)]',
          )}
        >
          {visibleParts.length === 0 && isStreaming ? <StreamingCursor className={isUser ? 'bg-white' : undefined} /> : null}
          {visibleParts.map((part, index) => (
            <MessageBlockRenderer key={`${message.id}-${index}-${part.type}`} part={part} role={message.role} streaming={isStreaming && index === visibleParts.length - 1} />
          ))}
        </div>
        <div className={cn('flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100', isUser ? 'mt-1' : 'mt-0.5')}>
          <BranchSwitcher branch={branch} onSelectSibling={onSelectSibling} />
          {canBranch && (
            <button
              type="button"
              onClick={() => onBranchFrom?.(message.id)}
              className="caption inline-flex items-center gap-1 rounded-[var(--r-pill)] bg-[var(--surface-card)] px-2 py-1 text-[var(--body-strong)] hover:bg-[var(--surface-strong)]"
              title={isUser ? '重新回答' : '从这里继续'}
            >
              {isUser ? <RotateCcw size={12} /> : <GitBranchPlus size={12} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
