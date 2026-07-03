import type { UIMessage } from 'ai';
import { GitBranchPlus, RotateCcw } from 'lucide-react';
import { cn } from '../../lib/cn';
import { BranchSwitcher } from './BranchSwitcher';
import { MessageBlockRenderer } from './MessageBlockRenderer';
import { StreamingCursor } from './StreamingCursor';
import { TriggerCard } from './TriggerCard';
import { isBoundaryPart, type BranchInfo } from './message-types';

export function MessageBubble({
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
  const visibleParts = message.parts.filter((part) => !isBoundaryPart(part));
  const canBranch = !isStreaming && Boolean(onBranchFrom);
  return (
    <div className={cn('group flex py-3', isUser ? 'justify-end pl-12' : 'justify-start pr-8 max-md:pr-0')}>
      <div className={cn('flex max-w-full items-start gap-2', isUser && 'flex-row-reverse')}>
        <div
          className={cn(
            'min-w-0 space-y-3 rounded-[var(--r-md)]',
            isUser ? 'bg-[var(--ink)] px-4 py-2.5 text-white shadow-[var(--shadow-sm)]' : 'bg-transparent text-[var(--body-strong)]',
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
              className="caption inline-flex items-center gap-1 rounded-[var(--r-pill)] border border-[var(--hairline)] bg-white px-2 py-1 text-[var(--body-strong)] shadow-[var(--shadow-sm)] hover:bg-[var(--surface-hover)]"
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
