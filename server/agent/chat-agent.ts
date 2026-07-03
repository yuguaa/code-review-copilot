import { streamText, stepCountIs, convertToModelMessages, type UIMessage } from 'ai';
import { loadGlobalDefaultModel, resolveGlobalModelConfig, resolveModel, resolveRepositoryModelConfig } from '../modules/ai-models/ai-models.service';
import { buildReadTools } from './tools';
import { prepareWorkspace } from '../infrastructure/workspace/workspace.service';
import type { SessionWithRepository } from '../modules/sessions/session-message-store.service';
import { createLogger } from '../shared/logger/logger.service';
import { resolveRepositoryTools } from '../modules/tools/tools.service';

const log = createLogger('chat-agent');

/**
 * 对话 agent 指令：审查之后的追问、以及手动新建的仓库对话都走这里。
 * 与审查流程的关键区别：没有任何发布类工具，纯对话 + 只读取证，由模型自主决定何时用工具。
 */
const CHAT_INSTRUCTIONS = `你是这个仓库的研发助手，工作在一个已 checkout 好的本地仓库工作区里——当前目录就是仓库根。

会话历史里可能带着一次由 GitLab Webhook 触发的代码审查（触发指令与审查结论）。那次审查已经结束，它只是这轮对话的背景；你现在唯一的任务是回答用户的最新消息。

- 直接、自然地回答。寒暄、确认、一般性讨论不需要动用工具。
- 当回答需要事实依据（代码实现、变更内容、提交历史、项目约定）时，先用只读工具取证再回答：
  bash（grep/rg/find/cat/git log 等只读命令）、read_file、read_memory；审查会话里还可用 git_diff 查看本次审查的变更。
- 引用代码时给出 文件路径:行号，结论要能落到具体代码上，不要凭空猜测。
- 你没有发布评论、推送通知、修改记忆的能力，也不要尝试；这些属于审查流程，不属于对话。
- 不知道就说明还缺什么信息，不要空回复。全程使用简体中文。`;

/**
 * 把持久化历史整理成对话上下文：保留全部轮次的文本，剥离工具调用等过程性 parts。
 * 审查的中间取证过程不进上下文（结论文本已包含关键信息），模型需要细节时可以自己再查。
 */
export function toChatHistory(messages: UIMessage[]): UIMessage[] {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message): UIMessage | null => {
      const text = message.parts
        .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text.trim() : ''))
        .filter(Boolean)
        .join('\n')
        .trim();
      return text ? { ...message, parts: [{ type: 'text', text }] } : null;
    })
    .filter((message): message is UIMessage => message !== null);
}

/**
 * 创建一次追问对话的流式运行：直接和模型对话，必要时由模型自主调用只读工具。
 * 工作区能就绪就带工具（审查会话复用原 worktree，纯对话会话用默认分支）；
 * 准备失败不阻塞对话，降级为无工具纯问答。
 */
export async function createChatStream(opts: { session: SessionWithRepository; messages: UIMessage[] }) {
  const repo = opts.session.repository;
  const globalDefaultModel = await loadGlobalDefaultModel();
  // 未绑定仓库的会话（sessions API 允许）用全局默认模型，不要求仓库模型配置
  const modelConfig = repo
    ? resolveRepositoryModelConfig(repo, globalDefaultModel)
    : resolveGlobalModelConfig(globalDefaultModel);
  const model = resolveModel(modelConfig);

  let tools: ReturnType<typeof buildReadTools> | undefined;
  if (repo) {
    try {
      const workspace = await prepareWorkspace(opts.session);
      const enabledTools = await resolveRepositoryTools(repo.id);
      tools = buildReadTools({ repoId: repo.id, workdir: workspace.dir, diffRef: workspace.diffRef, enabledTools });
    } catch (err) {
      log.warn(`工作区准备失败，本轮对话不带工具 session=${opts.session.id}`, err);
    }
  }

  return streamText({
    model,
    system: CHAT_INSTRUCTIONS,
    messages: await convertToModelMessages(toChatHistory(opts.messages)),
    ...(tools ? { tools } : {}),
    stopWhen: stepCountIs(modelConfig.maxSteps),
    onError: ({ error }) => {
      log.error('对话模型流异常', {
        sessionId: opts.session.id,
        provider: modelConfig.provider,
        modelId: modelConfig.modelId,
        err: error,
      });
    },
  });
}
