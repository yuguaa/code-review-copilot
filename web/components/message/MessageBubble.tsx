import type { UIMessage } from 'ai';
import GitBranchPlus from 'lucide-react/dist/esm/icons/git-branch-plus';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw';
import ThumbsDown from 'lucide-react/dist/esm/icons/thumbs-down';
import ThumbsUp from 'lucide-react/dist/esm/icons/thumbs-up';
import { cn } from '../../lib/cn';
import type { MessageFeedbackValue } from '../../lib/types';
import { BranchSwitcher } from './BranchSwitcher';
import { MessageBlockRenderer } from './MessageBlockRenderer';
import { StreamingCursor } from './StreamingCursor';
import { TriggerCard } from './TriggerCard';
import { isBoundaryPart, type BranchInfo } from './message-types';
import { extractReviewFindings } from './review-findings';

export function MessageBubble({
  message,
  isTrigger,
  isStreaming,
  branch,
  onSelectSibling,
  onBranchFrom,
  onFeedback,
}: {
  message: UIMessage;
  isTrigger?: boolean;
  isStreaming?: boolean;
  branch?: BranchInfo;
  onSelectSibling?: (messageId: string) => void;
  onBranchFrom?: (messageId: string) => void;
  onFeedback?: (messageId: string, feedback: MessageFeedbackValue, findingText?: string) => void;
}) {
  if (isTrigger) return <TriggerCard message={message} />;

  const isUser = message.role === 'user';
  const visibleParts = message.parts.filter((part) => !isBoundaryPart(part));
  const canBranch = !isStreaming && Boolean(onBranchFrom);
  const feedback = feedbackOf(visibleParts);
  const hasFindingFeedback = !isUser && !isStreaming && visibleParts.some((part) => {
    return part.type === 'text' && extractReviewFindings(part.text).length > 0;
  });
  const canFeedback = !isUser && !isStreaming && Boolean(onFeedback) && !hasFindingFeedback;
  return (
    <div className={cn('group flex py-3.5', isUser ? 'justify-end pl-12' : 'justify-start pr-8 max-md:pr-0')}>
      <div className={cn('flex max-w-full items-start gap-2', isUser && 'flex-row-reverse')}>
        <div
          className={cn(
            'min-w-0 space-y-3 rounded-[var(--r-md)]',
            isUser
              ? 'bg-[var(--primary)] px-4 py-2.5 text-white shadow-[var(--shadow-sm)]'
              : 'assistant-message border border-[var(--line-subtle)] px-5 py-4 text-[var(--body-strong)] shadow-[0_10px_28px_-24px_rgba(31,39,34,0.36)]',
          )}
        >
          {visibleParts.length === 0 && isStreaming ? <StreamingCursor className={isUser ? 'bg-white' : undefined} /> : null}
          {visibleParts.map((part, index) => (
            <MessageBlockRenderer
              key={`${message.id}-${index}-${part.type}`}
              part={part}
              role={message.role}
              streaming={isStreaming && index === visibleParts.length - 1}
              messageId={message.id}
              onFindingFeedback={onFeedback}
            />
          ))}
        </div>
        <div className={cn('flex items-center gap-1 opacity-45 transition-opacity group-hover:opacity-100 focus-within:opacity-100', isUser ? 'mt-1' : 'mt-0.5')}>
          <BranchSwitcher branch={branch} onSelectSibling={onSelectSibling} />
          {canFeedback && (
            <span className="caption inline-flex items-center gap-1 rounded-[var(--r-pill)] border border-[var(--line-default)] bg-[var(--surface-card)] px-1 py-1 text-[var(--body-strong)] shadow-[var(--shadow-sm)]">
              <button
                type="button"
                onClick={() => onFeedback?.(message.id, 'up')}
                aria-label="认可这条发现"
                title="认可这条发现"
                className={cn(
                  'cursor-pointer rounded-[var(--r-pill)] border border-transparent p-1 transition-[background-color,border-color,color,transform] hover:border-[var(--line-default)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] active:scale-95',
                  feedback === 'up' ? 'bg-[var(--brand-mint)] text-[var(--ink)]' : 'text-[var(--muted)]',
                )}
              >
                <ThumbsUp size={12} />
              </button>
              <button
                type="button"
                onClick={() => onFeedback?.(message.id, 'down')}
                aria-label="否定这条发现"
                title="否定这条发现"
                className={cn(
                  'cursor-pointer rounded-[var(--r-pill)] border border-transparent p-1 transition-[background-color,border-color,color,transform] hover:border-[var(--line-default)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] active:scale-95',
                  feedback === 'down' ? 'bg-[var(--brand-coral)]/15 text-[var(--brand-coral)]' : 'text-[var(--muted)]',
                )}
              >
                <ThumbsDown size={12} />
              </button>
            </span>
          )}
          {canBranch && (
            <button
              type="button"
              onClick={() => onBranchFrom?.(message.id)}
              className="caption inline-flex cursor-pointer items-center gap-1 rounded-[var(--r-pill)] border border-[var(--line-default)] bg-[var(--surface-card)] px-2 py-1 text-[var(--body-strong)] shadow-[var(--shadow-sm)] transition-[background-color,border-color,transform] hover:border-[var(--line-accent)] hover:bg-white active:scale-95"
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

function feedbackOf(parts: UIMessage['parts']): MessageFeedbackValue | null {
  for (const part of parts) {
    const value = (part as { feedback?: unknown }).feedback;
    if (value === 'up' || value === 'down') return value;
  }
  return null;
}
