import { lazy, Suspense, useState } from 'react';
import type { UIMessage } from 'ai';
import Brain from 'lucide-react/dist/esm/icons/brain';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import CircleDashed from 'lucide-react/dist/esm/icons/circle-dashed';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle';
import ThumbsDown from 'lucide-react/dist/esm/icons/thumbs-down';
import ThumbsUp from 'lucide-react/dist/esm/icons/thumbs-up';
import { cn } from '../../lib/cn';
import { StreamingCursor } from './StreamingCursor';
import { isBoundaryPart, type MessagePart } from './message-types';
import { extractReviewFindings } from './review-findings';
import type { MessageFeedbackValue, MessageFindingFeedback } from '../../lib/types';
import { JsonPanel, ToolEvidenceBlock } from './ToolEvidenceBlock';

const MarkdownBlock = lazy(() => import('./MarkdownBlock').then((module) => ({ default: module.MarkdownBlock })));

function isTool(part: MessagePart): boolean {
  return part.type === 'dynamic-tool' || part.type.startsWith('tool-');
}

function MarkdownFallback({ text, streaming }: { text: string; streaming?: boolean }) {
  if (!text.trim() && !streaming) return null;
  return (
    <div className="min-w-0 whitespace-pre-wrap break-words text-base leading-7">
      {text}
      {streaming && <StreamingCursor />}
    </div>
  );
}

function PlainTextBlock({ text }: { text: string }) {
  if (!text.trim()) return null;
  return <p className="whitespace-pre-wrap break-words text-base leading-7">{text}</p>;
}

function ReasoningBlock({ part }: { part: MessagePart }) {
  const [open, setOpen] = useState(false);
  const record = part as unknown as Record<string, unknown>;
  const text = String(record.text ?? '');
  const streaming = record.state === 'streaming';
  if (!text.trim() && !streaming) return null;
  return (
    <div className="tool-evidence-card overflow-hidden rounded-[var(--r-md)] border border-[var(--line-default)] bg-[var(--surface-card)] text-xs shadow-[var(--shadow-sm)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[var(--body-strong)] transition-[background-color,transform] hover:bg-[var(--surface-hover)] active:scale-[0.99]"
      >
        {streaming ? <Loader2 size={13} className="shrink-0 animate-spin text-[var(--warning)]" /> : <Brain size={13} className="shrink-0 text-[var(--muted)]" />}
        <span className="caption truncate">推理过程{text && !open ? ` · ${text.slice(0, 72)}` : ''}</span>
        <ChevronRight size={12} className={cn('ml-auto shrink-0 text-[var(--muted-soft)] transition-transform', open && 'rotate-90')} />
      </button>
      {open && <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words border-t border-[var(--line-subtle)] bg-[var(--surface-soft)]/80 px-3 py-2.5 text-[var(--muted)]">{text}</pre>}
    </div>
  );
}

function UnknownBlock({ part }: { part: MessagePart }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-[var(--r-md)] border border-[var(--line-default)] bg-[var(--surface-soft)] text-xs shadow-[var(--shadow-sm)]">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[var(--muted)] transition-[background-color,transform] hover:bg-[var(--surface-hover)] active:scale-[0.99]">
        <CircleDashed size={13} className="shrink-0" />
        <span className="caption truncate">{String(part.type)}</span>
        <ChevronRight size={12} className={cn('ml-auto shrink-0 transition-transform', open && 'rotate-90')} />
      </button>
      {open && <JsonPanel label="内容" value={part} />}
    </div>
  );
}

export function MessageBlockRenderer({
  part,
  role,
  streaming,
  messageId,
  onFindingFeedback,
}: {
  part: MessagePart;
  role: UIMessage['role'];
  streaming?: boolean;
  messageId?: string;
  onFindingFeedback?: (messageId: string, feedback: MessageFeedbackValue, findingText: string) => void;
}) {
  if (isBoundaryPart(part)) return null;
  if (part.type === 'text') {
    if (role !== 'assistant') return <PlainTextBlock text={part.text} />;
    const isStreaming = streaming || (part as { state?: string }).state === 'streaming';
    const findings = !isStreaming ? extractReviewFindings(part.text, findingFeedbacksOf(part)) : [];
    return (
      <>
        <Suspense fallback={<MarkdownFallback text={part.text} streaming={isStreaming} />}>
          <MarkdownBlock text={part.text} streaming={isStreaming} />
        </Suspense>
        {messageId && onFindingFeedback && findings.length > 0 && (
          <div className="mt-3 space-y-1.5 border-t border-[var(--line-subtle)] pt-3">
            {findings.map((finding) => (
              <div
                key={finding.id}
                className="flex items-start gap-2 rounded-[var(--r-sm)] border border-[var(--line-subtle)] bg-[var(--surface-soft)]/70 px-2.5 py-2"
              >
                <span className="caption mt-0.5 shrink-0 text-[var(--muted-soft)]">{finding.severity}</span>
                <p className="min-w-0 flex-1 text-sm leading-6 text-[var(--body-strong)]">{finding.text}</p>
                <FindingFeedbackButtons
                  value={finding.feedback}
                  onFeedback={(feedback) => onFindingFeedback(messageId, feedback, finding.text)}
                />
              </div>
            ))}
          </div>
        )}
      </>
    );
  }
  if (part.type === 'reasoning') return <ReasoningBlock part={part} />;
  if (isTool(part)) return <ToolEvidenceBlock part={part as unknown as Record<string, unknown>} />;
  return <UnknownBlock part={part} />;
}

function findingFeedbacksOf(part: MessagePart): MessageFindingFeedback[] {
  const value = (part as { findingFeedbacks?: unknown }).findingFeedbacks;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is MessageFindingFeedback => {
    const entry = item as { text?: unknown; feedback?: unknown };
    return typeof entry.text === 'string' && (entry.feedback === 'up' || entry.feedback === 'down');
  });
}

function FindingFeedbackButtons({
  value,
  onFeedback,
}: {
  value: MessageFeedbackValue | null;
  onFeedback: (feedback: MessageFeedbackValue) => void;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={() => onFeedback('up')}
        aria-label="确认这个问题真实存在"
        aria-pressed={value === 'up'}
        title="确认这个问题真实存在"
        className={cn(
          'cursor-pointer rounded-[var(--r-pill)] border border-transparent p-1 transition-[background-color,border-color,color,transform] hover:border-[var(--line-default)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] active:scale-95',
          value === 'up' ? 'bg-[var(--brand-cyan)]/18 text-[var(--ink)]' : 'text-[var(--muted)]',
        )}
      >
        <ThumbsUp size={12} />
      </button>
      <button
        type="button"
        onClick={() => onFeedback('down')}
        aria-label="认为这个问题是误报"
        aria-pressed={value === 'down'}
        title="认为这个问题是误报"
        className={cn(
          'cursor-pointer rounded-[var(--r-pill)] border border-transparent p-1 transition-[background-color,border-color,color,transform] hover:border-[var(--line-default)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] active:scale-95',
          value === 'down' ? 'bg-[var(--brand-coral)]/15 text-[var(--brand-coral)]' : 'text-[var(--muted)]',
        )}
      >
        <ThumbsDown size={12} />
      </button>
    </span>
  );
}
