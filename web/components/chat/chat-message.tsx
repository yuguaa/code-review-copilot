import { useState } from 'react';
import type { UIMessage } from 'ai';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  GitBranchPlusIcon,
  RotateCcwIcon,
  WebhookIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageToolbar,
} from '@web/components/ai-elements/message';
import { Button } from '@web/components/ui/button';
import { ButtonGroup, ButtonGroupText } from '@web/components/ui/button-group';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@web/components/ui/collapsible';
import type { MessageFeedbackValue, MessageTreeNode } from '@web/lib/types';
import { cn } from '@web/lib/utils';
import { ChatMessageParts } from './message-parts';

type BranchInfo = Pick<MessageTreeNode, 'siblingIds' | 'siblingIndex' | 'siblingCount'>;

export function ChatMessage({
  message,
  isTrigger,
  streaming,
  branch,
  onSelectSibling,
  onBranchFrom,
  onFeedback,
}: {
  message: UIMessage;
  isTrigger?: boolean;
  streaming?: boolean;
  branch?: BranchInfo;
  onSelectSibling?: (messageId: string) => void;
  onBranchFrom?: (messageId: string) => void;
  onFeedback?: (messageId: string, feedback: MessageFeedbackValue, findingText: string) => void;
}) {
  if (isTrigger) return <TriggerMessage message={message} />;

  const isUser = message.role === 'user';
  const canBranch = !streaming && Boolean(onBranchFrom);

  return (
    <Message from={message.role}>
      <MessageContent>
        <ChatMessageParts message={message} streaming={streaming} onFindingFeedback={onFeedback} />
      </MessageContent>
      <MessageToolbar className={cn('mt-0', isUser && 'justify-end')}>
        <MessageActions>
          <BranchSwitcher branch={branch} onSelectSibling={onSelectSibling} />
          {canBranch ? (
            <MessageAction
              tooltip={isUser ? '重新回答' : '从这里继续'}
              onClick={() => onBranchFrom?.(message.id)}
            >
              {isUser ? <RotateCcwIcon /> : <GitBranchPlusIcon />}
            </MessageAction>
          ) : null}
        </MessageActions>
        <MessageActions>
          <CopyAction message={message} />
        </MessageActions>
      </MessageToolbar>
    </Message>
  );
}

function CopyAction({ message }: { message: UIMessage }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    const text = message.parts
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('')
      .trim();
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast.success('已复制');
      window.setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <MessageAction tooltip="复制内容" onClick={copy}>
      {copied ? <CheckIcon /> : <CopyIcon />}
    </MessageAction>
  );
}

/** 消息分叉切换：同一位置的多个回答之间来回查看。 */
function BranchSwitcher({
  branch,
  onSelectSibling,
}: {
  branch?: BranchInfo;
  onSelectSibling?: (messageId: string) => void;
}) {
  if (!branch || branch.siblingCount <= 1 || !onSelectSibling) return null;

  const previous = branch.siblingIds[branch.siblingIndex - 1];
  const next = branch.siblingIds[branch.siblingIndex + 1];

  return (
    <ButtonGroup>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="上一条分支"
        disabled={!previous}
        onClick={() => previous && onSelectSibling(previous)}
      >
        <ChevronLeftIcon />
      </Button>
      <ButtonGroupText className="h-6 px-1 text-xs tabular-nums">
        {branch.siblingIndex + 1}/{branch.siblingCount}
      </ButtonGroupText>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="下一条分支"
        disabled={!next}
        onClick={() => next && onSelectSibling(next)}
      >
        <ChevronRightIcon />
      </Button>
    </ButtonGroup>
  );
}

/** Webhook 触发消息：默认收起，展开可看原始触发内容。 */
function TriggerMessage({ message }: { message: UIMessage }) {
  const [open, setOpen] = useState(false);
  const text = message.parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('')
    .trim();

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="overflow-hidden rounded-lg border bg-card">
        <CollapsibleTrigger className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-muted/50">
          <WebhookIcon className="size-4 shrink-0" />
          <span className="text-xs font-medium tracking-wide">Webhook 触发审查</span>
          <span className="truncate text-sm text-muted-foreground">{open ? '' : text.split('\n')[0]}</span>
          <ChevronDownIcon
            className={cn('ml-auto size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="border-t bg-muted/40 px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {text}
          </pre>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
