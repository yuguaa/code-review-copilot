import type { UIMessage } from 'ai';
import type { SessionWithRepository } from '../sessions/session-message-store.service';
import { sendReviewDingtalkNotification } from '../notifications/notifications.service';

type RepositoryForDingtalk = NonNullable<SessionWithRepository['repository']>;
type MessagePartRecord = Record<string, unknown>;

function isRecord(value: unknown): value is MessagePartRecord {
  return value !== null && typeof value === 'object';
}

function textPartValue(part: unknown): string {
  if (!isRecord(part)) return '';
  return part.type === 'text' && typeof part.text === 'string' ? part.text.trim() : '';
}

function reviewCommentMarkdown(part: unknown): string {
  if (!isRecord(part)) return '';
  const type = typeof part.type === 'string' ? part.type : '';
  const toolName = typeof part.toolName === 'string' ? part.toolName : '';
  if (type !== 'tool-post_review_comment' && toolName !== 'post_review_comment') return '';
  const input = toolInputOf(part);
  return typeof input?.markdown === 'string' ? input.markdown.trim() : '';
}

function inlineReviewComment(part: unknown): string {
  if (!isRecord(part)) return '';
  const type = typeof part.type === 'string' ? part.type : '';
  const toolName = typeof part.toolName === 'string' ? part.toolName : '';
  if (type !== 'tool-post_inline_comment' && toolName !== 'post_inline_comment') return '';
  const input = toolInputOf(part);
  const path = typeof input?.path === 'string' ? input.path.trim() : '';
  const line = typeof input?.line === 'number' ? input.line : null;
  const body = typeof input?.body === 'string' ? input.body.trim() : '';
  if (!body) return '';
  return path && line ? `- ${path}:${line}\n  ${body}` : `- ${body}`;
}

function toolInputOf(part: MessagePartRecord): MessagePartRecord | null {
  if (isRecord(part.input)) return part.input;
  if (isRecord(part.rawInput)) return part.rawInput;
  if (isRecord(part.args)) return part.args;
  if (isRecord(part.toolCall) && isRecord(part.toolCall.args)) return part.toolCall.args;
  return null;
}

function toolReviewTextOf(messages: UIMessage[]): string {
  const assistantMessages = messages.filter((message) => message.role === 'assistant');
  const reviewComment = [...assistantMessages]
    .reverse()
    .flatMap((message) => message.parts.map((part) => reviewCommentMarkdown(part)))
    .find(Boolean);
  const inlineComments = assistantMessages.flatMap((message) => message.parts.map((part) => inlineReviewComment(part))).filter(Boolean);
  if (reviewComment && inlineComments.length) return [reviewComment, '', '## 行级问题', ...inlineComments].join('\n');
  if (reviewComment) return reviewComment;
  return inlineComments.length ? ['## 行级问题', ...inlineComments].join('\n') : '';
}

function finalAssistantTextOf(messages: UIMessage[]): string {
  const assistantMessages = messages.filter((message) => message.role === 'assistant');
  const textBlocks = assistantMessages
    .map((message) => message.parts.map((part) => textPartValue(part)).filter(Boolean).join('\n\n').trim())
    .filter(Boolean);
  return textBlocks.at(-1) ?? '';
}

function finalReviewTextOf(messages: UIMessage[]): string {
  return toolReviewTextOf(messages) || finalAssistantTextOf(messages);
}

function titleOf(session: SessionWithRepository): string {
  const repo = session.repository?.path ?? '未绑定仓库';
  const title = session.mrIid ? `!${session.mrIid} ${session.mrTitle ?? session.title ?? ''}` : session.title ?? '审查完成';
  return `[代码审查] ${repo} ${title}`.trim();
}

function contextOf(session: SessionWithRepository): string {
  const branch =
    session.sourceBranch && session.targetBranch
      ? `${session.sourceBranch} → ${session.targetBranch}`
      : session.sourceBranch ?? session.targetBranch ?? '-';
  return [
    `- 仓库：${session.repository?.path ?? '未绑定仓库'}`,
    `- 分支：${branch}`,
    session.commitSha ? `- Commit：${session.commitSha}` : '',
    session.mrIid ? `- MR：!${session.mrIid}` : '- 类型：Push',
    session.author ? `- 提交者：${session.author}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 后台审查完成后的确定性通知。
 * 钉钉开关仍由仓库控制；机器人配置优先仓库级，缺省走全局配置。
 */
export function notifyReviewCompleted(session: SessionWithRepository, messages: UIMessage[]): Promise<'sent' | 'skipped'> {
  const repo = session.repository;
  if (!repo?.enableDingtalk) return Promise.resolve('skipped');

  const resultText = finalReviewTextOf(messages) || '审查已完成，但模型没有返回可展示的文本结果。请进入会话查看工具调用记录。';
  const title = titleOf(session);
  const text = [`## ${title}`, '', contextOf(session), '', '---', '', resultText].join('\n');
  return sendReviewDingtalkNotification(repo, title, text);
}
