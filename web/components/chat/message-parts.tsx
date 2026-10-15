import type { UIMessage } from 'ai';
import { cjk } from '@streamdown/cjk';
import { MessageResponse } from '@web/components/ai-elements/message';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@web/components/ai-elements/reasoning';
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@web/components/ai-elements/tool';
import { cn } from '@web/lib/utils';
import type { MessageFeedbackValue, MessageFindingFeedback } from '@web/lib/types';
import { isBoundaryPart, isReviewActivityPart, type MessagePart } from '@web/components/message/message-types';
import { extractReviewFindings, findingFeedbackPartIndex } from '@web/components/message/review-findings';
import { shikiCodeHighlighter } from '@web/components/message/shiki-plugin';
import { streamdownTranslations } from '@web/lib/streamdown-translations';
import { FindingFeedbackList } from './finding-feedback';

const TOOL_LABEL: Record<string, string> = {
  bash: '执行命令',
  read_file: '读取文件',
  git_diff: '查看变更 diff',
  read_memory: '读取项目记忆',
  write_memory: '更新项目记忆',
  record_evidence: '记录审查证据',
  record_verify_evidence: '记录复核证据',
  submit_verified_review: '提交复核结论',
  post_review_comment: '发布审查评论',
  post_inline_comment: '发布行级评论',
  send_dingtalk_notification: '发送钉钉通知',
  delegate_security: '委派安全审查',
  delegate_architecture: '委派架构审查',
  delegate_performance: '委派性能审查',
};

const STREAMDOWN_PLUGINS = { cjk, code: shikiCodeHighlighter };

function toolName(part: MessagePart): string {
  const type = String(part.type);
  const raw = type === 'dynamic-tool' ? String((part as { toolName?: string }).toolName ?? '') : type.replace(/^tool-/, '');
  return TOOL_LABEL[raw] ?? raw;
}

function isToolPart(part: MessagePart): boolean {
  return part.type === 'dynamic-tool' || part.type.startsWith('tool-');
}

export function StreamingCursor({ className }: { className?: string }) {
  return <span className={cn('inline-block h-4 w-1.5 translate-y-0.5 animate-pulse rounded-full bg-foreground/70', className)} />;
}

/** 单条消息的 parts 渲染：正文按文档流，工具调用与推理过程折叠。 */
export function ChatMessageParts({
  message,
  streaming,
  onFindingFeedback,
}: {
  message: UIMessage;
  streaming?: boolean;
  onFindingFeedback?: (messageId: string, feedback: MessageFeedbackValue, findingText: string) => void;
}) {
  const parts = message.parts.filter((part) => !isBoundaryPart(part) && !isReviewActivityPart(part));
  const feedbackPartIndex =
    message.role === 'assistant' && !streaming ? findingFeedbackPartIndex(parts) : -1;

  return (
    <>
      {parts.map((part, index) => {
        const isLast = index === parts.length - 1;
        const partStreaming = Boolean(streaming && isLast);

        if (part.type === 'text') {
          if (message.role !== 'assistant') {
            return (
              <p key={`${message.id}-${index}`} className="whitespace-pre-wrap break-words">
                {part.text}
              </p>
            );
          }
          const findings = partStreaming ? [] : extractReviewFindings(part.text, feedbacksOf(part));
          return (
            <div key={`${message.id}-${index}`} className="min-w-0 space-y-3">
              {part.text.trim() ? (
                <MessageResponse
                  className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                  controls={{ code: { copy: true, download: false }, mermaid: true, table: true }}
                  isAnimating={partStreaming}
                  lineNumbers
                  plugins={STREAMDOWN_PLUGINS}
                  shikiTheme={shikiCodeHighlighter.getThemes()}
                  translations={streamdownTranslations}
                >
                  {part.text}
                </MessageResponse>
              ) : null}
              {partStreaming ? <StreamingCursor /> : null}
              {index === feedbackPartIndex && findings.length > 0 && message.id && onFindingFeedback ? (
                <FindingFeedbackList
                  findings={findings}
                  onFeedback={(feedback, findingText) => onFindingFeedback(message.id, feedback, findingText)}
                />
              ) : null}
            </div>
          );
        }

        if (part.type === 'reasoning') {
          const text = String((part as { text?: string }).text ?? '');
          if (!text.trim() && !partStreaming) return null;
          return (
            <Reasoning key={`${message.id}-${index}`} isStreaming={partStreaming} defaultOpen={partStreaming}>
              <ReasoningTrigger />
              <ReasoningContent>{text}</ReasoningContent>
            </Reasoning>
          );
        }

        if (isToolPart(part)) {
          const toolPart = part as unknown as {
            state: string;
            input?: unknown;
            output?: unknown;
            errorText?: string;
          };
          return (
            <Tool key={`${message.id}-${index}`} defaultOpen={false}>
              <ToolHeader
                title={toolName(part)}
                type={part.type as never}
                state={toolPart.state as never}
              />
              <ToolContent>
                <ToolInput input={toolPart.input} />
                <ToolOutput output={toolPart.output} errorText={toolPart.errorText} />
              </ToolContent>
            </Tool>
          );
        }

        return null;
      })}
    </>
  );
}

function feedbacksOf(part: MessagePart): MessageFindingFeedback[] {
  const value = (part as { findingFeedbacks?: unknown }).findingFeedbacks;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is MessageFindingFeedback => {
    const entry = item as { text?: unknown; feedback?: unknown };
    return typeof entry.text === 'string' && (entry.feedback === 'up' || entry.feedback === 'down');
  });
}
