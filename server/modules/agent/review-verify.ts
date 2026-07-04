import { generateText, stepCountIs, type LanguageModel, type UIMessage } from 'ai';
import { buildReadTools, type ReviewContext } from './tools';

const VERIFY_INSTRUCTIONS = `你是代码审查 verify agent。你的任务是复核主审查草稿是否可信，而不是重新写一篇泛泛总结。

工作要求：
- 只能基于只读工具取证：read_memory、git_diff、read_file、bash。
- 对草稿中的每条问题逐条核验：文件、行号、影响、修复建议是否能被代码和 diff 支撑。
- 删除无法取证、证据不足、重复、夸大或与用户反馈沉淀冲突的问题。
- 如发现草稿漏掉了高置信问题，可以补充，但必须给出文件:行和清晰证据。
- 最终只输出干净可信的审查总评，不要输出核验过程、工具调用摘要或“我验证了”等元说明。
- 输出按「严重/一般/建议」分组；每条包含 文件:行、问题、影响、修复建议。
- 没有实质问题就明确输出“未发现需要阻塞的实质问题。”
- 全程使用简体中文。`;

function latestAssistantText(messages: UIMessage[]): string {
  return messages
    .filter((message) => message.role === 'assistant')
    .map((message) =>
      message.parts
        .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text.trim() : ''))
        .filter(Boolean)
        .join('\n\n')
        .trim(),
    )
    .filter(Boolean)
    .at(-1) ?? '';
}

export function withVerifiedReviewText(messages: UIMessage[], verifiedText: string): UIMessage[] {
  const index = messages.findLastIndex((message) => message.role === 'assistant');
  if (index < 0) {
    return [
      ...messages,
      { id: `verified-${Date.now()}`, role: 'assistant', parts: [{ type: 'text', text: verifiedText }] },
    ];
  }
  return messages.map((message, currentIndex) => {
    if (currentIndex !== index) return message;
    return {
      ...message,
      parts: [{ type: 'text', text: verifiedText }],
    };
  });
}

export function verifyReviewResult({
  ctx,
  messages,
  model,
  maxSteps,
}: {
  ctx: ReviewContext;
  messages: UIMessage[];
  model: LanguageModel;
  maxSteps: number;
}): Promise<string> {
  const draft = latestAssistantText(messages).trim();
  const prompt = [
    '请复核下面的主审查草稿，并输出最终可信审查总评。',
    '',
    '## 主审查草稿',
    draft || '（主审查没有返回可见草稿）',
  ].join('\n');

  return generateText({
    model,
    system: VERIFY_INSTRUCTIONS,
    prompt,
    tools: buildReadTools(ctx),
    stopWhen: stepCountIs(Math.max(1, Math.min(maxSteps, 8))),
  }).then((result) => result.text.trim() || '未发现需要阻塞的实质问题。');
}
