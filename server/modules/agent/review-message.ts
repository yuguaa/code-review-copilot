import type { UIMessage } from 'ai';
import { randomUUID } from 'node:crypto';

const EMPTY_REVIEW_TEXT = '本轮模型没有返回可展示的文本结果。请稍后重试，或换一种问法让 Agent 重新回答。';

function hasAssistantTextAfterLatestUser(messages: UIMessage[]): boolean {
  const latestUserIndex = messages.findLastIndex((message) => message.role === 'user');
  const messagesToCheck = latestUserIndex === -1 ? messages : messages.slice(latestUserIndex + 1);

  return messagesToCheck.some((message) =>
    message.role === 'assistant' &&
    message.parts.some((part) => part.type === 'text' && typeof part.text === 'string' && part.text.trim()),
  );
}

/**
 * Webhook 首轮审查必须像普通聊天一样落下一条可见 assistant 回复。
 * 如果模型只产出了 step/tool 事件而没有文本，追加一条可见说明，便于页面继续对话和钉钉同步。
 */
export function ensureVisibleAssistantReply(messages: UIMessage[]): UIMessage[] {
  if (hasAssistantTextAfterLatestUser(messages)) return messages;
  return [
    ...messages,
    {
      id: randomUUID(),
      role: 'assistant',
      parts: [{ type: 'text', text: EMPTY_REVIEW_TEXT }],
    },
  ];
}
