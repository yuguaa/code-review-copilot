import { streamText, stepCountIs, convertToModelMessages, type UIMessage } from 'ai';
import { resolveModel } from './model';
import { buildReviewContext, buildTools } from './tools';
import { buildDelegateTools } from './subagents';
import type { SessionWithRepository } from '../lib/chat-store';

/** 主审查 agent 的基础指令（工具感知）。 */
const BASE_INSTRUCTIONS = `你是一名资深代码审查 Agent，运行在一个支持工具调用的循环里。

工作方式：
1. 先用 list_changed_files 了解本次变更涉及哪些文件。
2. 用 fetch_diff 获取关键文件的 diff；必要时用 read_file 读取完整文件，理解跨行、跨文件的上下文。
3. 聚焦真实问题：bug、安全风险、并发/边界、错误处理、明显的可维护性问题。不要堆砌琐碎风格意见。
4. 当变更明显涉及安全 / 架构 / 性能时，按需委派对应专项 agent 复核：delegate_security / delegate_architecture / delegate_performance，并把它们的发现整合进你的结论。不要无脑全部委派，按变更性质判断。
5. 审查完成后，用 post_review_comment 把结论（含 subagent 的发现）作为一条 Markdown 总评发布到 MR。

输出与评论要求：
- 按严重级别分组：「严重 / 一般 / 建议」。
- 每条问题给出：文件路径与行号、问题、影响、修复建议。
- 没有发现实质问题时，如实说明并给一句总体评价，不要编造问题。
- 全程用简体中文。

你处在多轮对话中：用户可能在审查后继续追问，请基于已获取的 diff/文件上下文直接回答，必要时再调用工具补充。`;

/** 组合系统提示词：基础指令 + 仓库自定义审查要求。 */
export function buildInstructions(repo: SessionWithRepository['repository']): string {
  const custom = repo?.defaultReviewPrompt?.trim();
  return custom ? `${BASE_INSTRUCTIONS}\n\n## 本仓库的额外审查要求\n${custom}` : BASE_INSTRUCTIONS;
}

/**
 * 创建一次审查/对话的流式运行。
 * chat route（追问）与 webhook（首轮自动审查）共用此函数。
 */
export async function createReviewStream(opts: { session: SessionWithRepository; messages: UIMessage[] }) {
  const repo = opts.session.repository;
  const ctx = buildReviewContext(opts.session);
  const model = resolveModel(repo);
  return streamText({
    model,
    system: buildInstructions(repo),
    messages: await convertToModelMessages(opts.messages),
    tools: { ...buildTools(ctx), ...buildDelegateTools(ctx, model) },
    stopWhen: stepCountIs(repo?.maxSteps ?? 16),
  });
}
