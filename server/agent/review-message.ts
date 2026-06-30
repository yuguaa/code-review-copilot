import type { UIMessage } from 'ai';
import { randomUUID } from 'node:crypto';

const EMPTY_REVIEW_TEXT = '审查已完成，但模型没有返回可展示的文本结果。请查看本轮工具调用记录，或继续追问让 Agent 补充总结。';

function hasAssistantText(messages: UIMessage[]): boolean {
  return messages.some((message) =>
    message.role === 'assistant' &&
    message.parts.some((part) => part.type === 'text' && typeof part.text === 'string' && part.text.trim()),
  );
}

/**
 * Webhook 首轮审查必须像普通聊天一样落下一条可见 assistant 回复。
 * 如果模型只产出了 step/tool 事件而没有文本，追加一条可见说明，便于页面继续对话和钉钉同步。
 */
export function ensureVisibleAssistantReply(messages: UIMessage[]): UIMessage[] {
  if (hasAssistantText(messages)) return messages;
  return [
    ...messages,
    {
      id: randomUUID(),
      role: 'assistant',
      parts: [{ type: 'text', text: EMPTY_REVIEW_TEXT }],
    },
  ];
}
