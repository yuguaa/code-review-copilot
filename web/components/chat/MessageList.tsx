import type { UIMessage } from 'ai';
import Activity from 'lucide-react/dist/esm/icons/activity';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle';
import { Message } from '../Message';
import type { MessageFeedbackValue, MessageTreeNode, SessionDetail } from '../../lib/types';
import { isReviewActivityPart } from '../message/message-types';

type MessageListProps = {
  session: SessionDetail['session'];
  messages: UIMessage[];
  status: string;
  busy: boolean;
  reviewing: boolean;
  treeById: Map<string, MessageTreeNode>;
  onSelectSibling: (messageId: string) => void;
  onBranchFrom: (messageId: string) => void;
  onFeedback: (messageId: string, feedback: MessageFeedbackValue, findingText: string) => void;
};

export function MessageList({
  session,
  messages,
  status,
  busy,
  reviewing,
  treeById,
  onSelectSibling,
  onBranchFrom,
  onFeedback,
}: MessageListProps) {
  const isTriggerFirst = session.kind === 'review' && messages[0]?.role === 'user';
  const hasReviewActivity = messages.some((message) => message.parts.some(isReviewActivityPart));

  return (
    <div className="review-paper mx-auto min-h-full w-full max-w-[1120px] px-6 py-8 max-md:px-4 max-md:py-5">
      {messages.length === 0 && (
        <div className="technical-panel mx-auto mt-16 max-w-md rounded-[var(--r-lg)] bg-[var(--surface-card)] px-7 py-9 text-center text-[var(--ink)]">
          <p className="font-display text-xl">从一个具体问题开始</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">可以询问审查结论、变更风险，或某个文件的实现细节。</p>
        </div>
      )}
      {messages.map((message, index) => (
        <Message
          key={message.id}
          message={message}
          isTrigger={isTriggerFirst && index === 0}
          isStreaming={status === 'streaming' && index === messages.length - 1 && message.role === 'assistant'}
          branch={treeById.get(message.id)}
          onSelectSibling={onSelectSibling}
          onBranchFrom={reviewing ? undefined : onBranchFrom}
          onFeedback={reviewing ? undefined : onFeedback}
        />
      ))}
      {/* 仅在还没有 assistant 消息时显示极简等待；流开始后由最后一条消息承载光标与正文。 */}
      {status === 'submitted' && messages.at(-1)?.role !== 'assistant' && (
        <div className="inline-flex items-center gap-2 rounded-[var(--r-sm)] bg-[var(--surface-card)] px-2 py-1.5 text-xs text-[var(--muted)] shadow-[var(--shadow-sm)]">
          <Loader2 size={13} className="animate-spin text-[var(--accent)]" />
        </div>
      )}
      {!busy && reviewing && !hasReviewActivity && (
        <div className="caption inline-flex items-center gap-2 rounded-[var(--r-sm)] border border-[var(--warning)]/24 bg-[var(--state-warning-bg)] px-3 py-1.5 text-[var(--ink)] shadow-[var(--shadow-sm)]">
          <Activity size={13} /> 后台审查进行中，回复会实时同步到这里
        </div>
      )}
    </div>
  );
}
