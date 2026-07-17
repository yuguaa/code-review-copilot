import type { UIMessage } from 'ai';
import GitBranchPlus from 'lucide-react/dist/esm/icons/git-branch-plus';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw';
import { cn } from '../../lib/cn';
import type { MessageFeedbackValue } from '../../lib/types';
import { BranchSwitcher } from './BranchSwitcher';
import { MessageBlockRenderer } from './MessageBlockRenderer';
import { StreamingCursor } from './StreamingCursor';
import { TriggerCard } from './TriggerCard';
import { isBoundaryPart, isReviewActivityPart, type BranchInfo } from './message-types';
import { findingFeedbackPartIndex } from './review-findings';

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
  onFeedback?: (messageId: string, feedback: MessageFeedbackValue, findingText: string) => void;
}) {
  if (isTrigger) return <TriggerCard message={message} />;

  const isUser = message.role === 'user';
  const visibleParts = message.parts.filter((part) => !isBoundaryPart(part) && !isReviewActivityPart(part));
  if (visibleParts.length === 0 && !isStreaming) return null;
  const canBranch = !isStreaming && Boolean(onBranchFrom);
  const feedbackPartIndex = !isUser && !isStreaming ? findingFeedbackPartIndex(visibleParts) : -1;
  return (
    <div className={cn('group flex py-3.5', isUser ? 'justify-end pl-12 max-md:pl-6' : 'justify-start px-4 max-md:px-0')}>
      <div className={cn('flex max-w-full flex-col gap-1.5', isUser ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'min-w-0 space-y-3 rounded-[var(--r-md)]',
            isUser
              ? 'max-w-[min(640px,100%)] bg-[var(--primary)] px-4 py-2.5 text-white shadow-[var(--shadow-sm)]'
              : 'assistant-message border border-[var(--line-subtle)] px-5 py-4 text-[var(--body-strong)] shadow-[var(--shadow-sm)]',
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
              onFindingFeedback={index === feedbackPartIndex ? onFeedback : undefined}
            />
          ))}
        </div>
        <div className="flex items-center gap-1 px-1 opacity-75 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100">
          <BranchSwitcher branch={branch} onSelectSibling={onSelectSibling} />
          {canBranch && (
            <button
              type="button"
              onClick={() => onBranchFrom?.(message.id)}
              className="caption inline-flex cursor-pointer items-center gap-1 rounded-[var(--r-pill)] border border-[var(--line-default)] bg-[var(--surface-card)] px-2 py-1 text-[var(--body-strong)] shadow-[var(--shadow-sm)] transition-[background-color,border-color,transform] hover:border-[var(--line-accent)] hover:bg-[var(--surface-hover)] active:scale-95"
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
