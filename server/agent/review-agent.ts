import { streamText, stepCountIs, convertToModelMessages, type UIMessage } from 'ai';
import { loadGlobalDefaultModel, resolveModel, resolveRepositoryModelConfig } from './model';
import { buildReadTools, buildReviewContext, buildTools } from './tools';
import { buildDelegateTools } from './subagents';
import { prepareWorkspace } from '../lib/workspace';
import type { SessionWithRepository } from '../lib/chat-store';
import { createLogger } from '../lib/logger';

const log = createLogger('review-agent');

type ReviewStreamMode = 'review' | 'chat';

/** 主审查 agent 的基础指令（工作区自主探索，不走固定脚本）。 */
const BASE_INSTRUCTIONS = `你是一名资深代码审查 Agent，工作在一个已 checkout 好的本地仓库工作区里——你的当前目录就是仓库根，可以像在本机一样自由探索整个代码库。

可用工具：
- bash：跑只读命令自由探索（grep/rg/find/cat/sed/awk/git log/git show 等，支持管道）
- read_file：读取任意文件完整内容
- git_diff：查看本次审查变更（MR 为目标分支到当前 HEAD；Push 为 before 到 after）
- read_memory / write_memory：读取与沉淀本仓库的项目记忆
- post_review_comment / post_inline_comment：把总评与行级问题发布到 MR 或 Push commit
- notify_dingtalk：推送结论到钉钉
- delegate_security / delegate_architecture / delegate_performance：委派专项 agent 复核

工作方式（自主决定，不必拘泥顺序）：
- 先 read_memory 了解本项目既有约定、架构与历史问题。
- 用 git_diff 看本次变更，再用 bash/read_file 顺着变更自由追溯：搜调用方、看相关实现、查历史、核对约定。不要只盯着 diff 文本，要理解真实上下文。
- 聚焦真实问题：bug、安全风险、并发/边界、错误处理、破坏既有约定、明显的可维护性/性能问题。不堆砌琐碎风格意见。
- 涉及安全/架构/性能的复杂变更，按需委派对应专项 agent 复核，并把其发现整合进结论。按变更性质判断，不无脑全委派。

输出：
- 行级问题用 post_inline_comment 精准贴到对应文件行；整体结论用 post_review_comment 发一条总评，按「严重/一般/建议」分组，每条给出 文件:行、问题、影响、修复建议。MR 会发布到 MR，Push 会发布到本次提交。
- 没有实质问题就如实说明，不编造。
- 审查结束后，把本次得到的、对后续审查有用的项目认知用 write_memory 沉淀（增量更新，保留既有记忆里仍有效的内容）。
- 全程用简体中文。

你处在多轮对话中：用户可能在审查后继续追问，请基于已探索的上下文直接输出文本回答，必要时再用工具补充；只有在执行审查并发布结论时才调用 post_review_comment / post_inline_comment / notify_dingtalk。`;

const CHAT_INSTRUCTIONS = `你是一名资深代码审查 Agent，工作在一个已 checkout 好的本地仓库工作区里——你的当前目录就是仓库根。

用户正在审查会话页面继续追问。你的任务是像正常对话一样直接回答用户最新消息。

会话里的第一条 GitLab Webhook 消息只是首轮审查的触发来源，不是后续追问时要反复执行的任务。

回答要求：
- 必须给出可展示的中文文本回复。
- 普通寒暄、确认、闲聊直接自然回复，不要触发审查流程。
- 只有用户明确询问代码、diff、文件、风险、原因、修复或要求重新审查时，才使用只读工具取证。
- 不要发布 MR / Push 评论，不要推送钉钉，不要沉淀项目记忆。
- 不知道就说明还缺少什么信息，不要空回复。`;

const REVIEW_SEED_PREFIXES = ['请审查本次 Push。', '请审查本次 Merge Request。'];
const CHAT_TOOL_INTENT_RE =
  /(代码|实现|文件|函数|组件|diff|变更|改动|审查|风险|bug|错误|报错|异常|为什么|原因|定位|查看|分析|项目|仓库|分支|commit|提交|重新|再审|问题|影响|修复|哪里|哪个|如何|怎么|what|why|how|review|file|code|change|diff|bug|error|risk)/i;

/** 组合系统提示词：基础指令 + 仓库自定义审查要求。 */
export function buildInstructions(repo: SessionWithRepository['repository'], mode: ReviewStreamMode = 'review'): string {
  if (mode === 'chat') return CHAT_INSTRUCTIONS;
  const custom = repo?.defaultReviewPrompt?.trim();
  return custom ? `${BASE_INSTRUCTIONS}\n\n## 本仓库的额外审查要求\n${custom}` : BASE_INSTRUCTIONS;
}

export function shouldUseChatTools(messages: UIMessage[]): boolean {
  const latestUserText = latestUserTextOf(messages);
  return CHAT_TOOL_INTENT_RE.test(latestUserText);
}

export function prepareChatMessages(messages: UIMessage[]): UIMessage[] {
  const cleaned = messages
    .filter((message, index) => !(index === 0 && isReviewSeedMessage(message)))
    .map(textOnlyMessage)
    .filter((message): message is UIMessage => Boolean(message));
  const latestUserIndex = cleaned.findLastIndex((message) => message.role === 'user');
  if (latestUserIndex === -1) return cleaned;
  const previousAssistantIndex = cleaned
    .slice(0, latestUserIndex)
    .findLastIndex((message) => message.role === 'assistant');
  const history = previousAssistantIndex === -1 ? [] : cleaned.slice(0, previousAssistantIndex + 1);
  return [...history, cleaned[latestUserIndex]];
}

function latestUserTextOf(messages: UIMessage[]): string {
  const latestUser = messages.findLast((message) => message.role === 'user');
  return latestUser ? textOf(latestUser) : '';
}

function isReviewSeedMessage(message: UIMessage): boolean {
  if (message.role !== 'user') return false;
  const text = textOf(message);
  return REVIEW_SEED_PREFIXES.some((prefix) => text.startsWith(prefix));
}

function textOnlyMessage(message: UIMessage): UIMessage | null {
  if (message.role !== 'user' && message.role !== 'assistant') return null;
  const text = textOf(message);
  if (!text) return null;
  return { ...message, parts: [{ type: 'text', text }] };
}

function textOf(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text.trim() : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * 创建一次审查/对话的流式运行。chat route（追问）与 webhook（首轮审查）共用。
 * 内部负责准备工作区（clone/fetch/worktree）并构造审查上下文。
 */
export async function createReviewStream(opts: {
  session: SessionWithRepository;
  messages: UIMessage[];
  mode?: ReviewStreamMode;
}) {
  const repo = opts.session.repository;
  const globalDefaultModel = await loadGlobalDefaultModel();
  const modelConfig = resolveRepositoryModelConfig(repo, globalDefaultModel);
  const model = resolveModel(modelConfig);
  const mode = opts.mode ?? 'review';
  const messages = mode === 'chat' ? prepareChatMessages(opts.messages) : opts.messages;
  const needsChatTools = mode === 'chat' && shouldUseChatTools(messages);
  const workspace = mode === 'review' || needsChatTools ? await prepareWorkspace(opts.session) : null;
  const ctx = workspace ? await buildReviewContext(opts.session, workspace) : null;
  const tools = mode === 'review'
    ? { ...buildTools(ctx!), ...buildDelegateTools(ctx!, model) }
    : needsChatTools && ctx
      ? buildReadTools(ctx)
      : undefined;

  return streamText({
    model,
    system: buildInstructions(repo, mode),
    messages: await convertToModelMessages(messages),
    ...(tools ? { tools } : {}),
    stopWhen: stepCountIs(modelConfig.maxSteps),
    onStepEnd: (step) => {
      if (!step.text?.trim() && step.toolCalls.length === 0) {
        log.warn('模型步骤无文本输出', {
          sessionId: opts.session.id,
          mode,
          provider: modelConfig.provider,
          modelId: modelConfig.modelId,
          finishReason: step.finishReason,
          rawFinishReason: step.rawFinishReason,
          reasoningLength: step.reasoningText?.length ?? 0,
          warnings: step.warnings,
        });
      }
    },
    onError: ({ error }) => {
      log.error('模型流异常', {
        sessionId: opts.session.id,
        mode,
        provider: modelConfig.provider,
        modelId: modelConfig.modelId,
        err: error,
      });
    },
  });
}
