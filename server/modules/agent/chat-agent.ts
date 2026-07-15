import { streamText, stepCountIs, convertToModelMessages, type ToolSet, type UIMessage } from 'ai';
import {
  loadGlobalDefaultModel,
  resolveGlobalModelConfig,
  resolveModel,
  resolveRepositoryModelConfig,
  type ModelConfig,
} from '../ai-models/ai-models.service';
import {
  buildPublishContext,
  buildPublishTools,
  buildReadTools,
  type PublishToolKey,
} from './tools';
import { prepareWorkspace } from '../../infrastructure/workspace/workspace.service';
import type { SessionWithRepository } from '../sessions/session-message-store.service';
import { createLogger } from '../../shared/logger/logger.service';
import { resolveRepositoryTools } from '../tools/tools.service';

const log = createLogger('chat-agent');

/**
 * 对话 agent 指令：审查之后的追问、以及手动新建的仓库对话都走这里。
 * 发布类工具只响应最新用户消息的明确授权，其余场景保持纯对话或只读取证。
 */
export const CHAT_INSTRUCTIONS = `你是这个仓库的研发助手，工作在一个已 checkout 好的本地仓库工作区里——当前目录就是仓库根。

会话历史里可能带着一次由 GitLab Webhook 触发的代码审查（触发指令与审查结论）。那次审查已经结束，它只是这轮对话的背景；你现在唯一的任务是回答用户的最新消息。

- 直接、自然地回答。寒暄、确认、一般性讨论不需要动用工具。
- 当回答需要事实依据（代码实现、变更内容、提交历史、项目约定）时，先用只读工具取证再回答：
  bash（grep/rg/find/cat/git log 等只读命令）、read_file、read_memory；审查会话里还可用 git_diff 查看本次审查的变更。
- 引用代码时给出 文件路径:行号，结论要能落到具体代码上，不要凭空猜测。
- 只有最新一条用户消息明确要求“发送、发布、回写”时，才可以调用发布工具；讨论发送方案、改写文案、预览内容、引用历史请求都不构成授权。
- post_review_comment 把完整内容发布到当前 MR 或 Push commit；post_inline_comment 发布 GitLab 行级评论；send_dingtalk_notification 发送钉钉通知。
- 用户同时指定多个渠道时逐个调用对应工具；工具不存在表示仓库渠道或 Tool 开关未启用，直接说明原因，禁止改用其它渠道。
- 不允许写项目记忆。
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

function latestUserText(messages: UIMessage[]): string {
  const message = [...messages].reverse().find((item) => item.role === 'user');
  if (!message) return '';
  return message.parts
    .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text.trim() : ''))
    .filter(Boolean)
    .join('\n');
}

const publishQuestionPattern = /^(?:怎么|如何|能否|能不能|是否|可不可以|可以不可以|为什么|请解释|请说明|讨论|预览|改写|生成)/;
const publishDiscussionPattern = /(?:怎么|如何|能否|能不能|是否|可不可以|可以不可以|讨论|预览|改写.{0,12}(?:文案|内容)|(?:发送|发布).{0,6}方案)/;
const publishNegationPattern = /(?:不要|别|暂不|先不|无需|不必).{0,12}(?:发|发送|发布|回写|推送|同步|通知)/;
const publishActionPattern = /(?:发|发送|发布|回写|推送|同步|通知)/;

/** 只从最新用户消息签发本轮发布权限，历史消息、代码内容和模型判断都不能扩大权限。 */
export function resolveChatPublishAuthorization(messages: UIMessage[]): ReadonlySet<PublishToolKey> {
  const text = latestUserText(messages).trim();
  const authorized = new Set<PublishToolKey>();
  if (
    !text
    || publishQuestionPattern.test(text)
    || publishDiscussionPattern.test(text)
    || publishNegationPattern.test(text)
    || /[吗么][？?]?$/.test(text)
  ) {
    return authorized;
  }
  if (!publishActionPattern.test(text)) return authorized;

  if (/钉钉|dingtalk/i.test(text)) authorized.add('send_dingtalk_notification');
  if (/行级|逐行|inline/i.test(text) && /gitlab|git\s*lab|mr|合并请求|评论/i.test(text)) {
    authorized.add('post_inline_comment');
  } else if (/gitlab|git\s*lab|mr|合并请求|评论/i.test(text)) {
    authorized.add('post_review_comment');
  }
  return authorized;
}

/**
 * 创建一次追问对话的流式运行：直接和模型对话，必要时由模型自主调用只读或发布工具。
 * 发布工具不依赖工作区；工作区准备失败时，只读能力不可用但明确授权的发送请求仍可执行。
 */
export async function createChatStream(opts: {
  session: SessionWithRepository;
  messages: UIMessage[];
  selectedModelConfig?: ModelConfig;
}) {
  const repo = opts.session.repository;
  const modelConfig: ModelConfig = opts.selectedModelConfig
    ? opts.selectedModelConfig
    : await loadGlobalDefaultModel().then((globalDefaultModel) =>
        // 未绑定仓库的会话（sessions API 允许）用全局默认模型，不要求仓库模型配置
        repo
          ? resolveRepositoryModelConfig(repo, globalDefaultModel)
          : resolveGlobalModelConfig(globalDefaultModel),
      );
  const model = resolveModel(modelConfig);

  let tools: ToolSet | undefined;
  if (repo) {
    const enabledTools = await resolveRepositoryTools(repo.id);
    const publishContext = { ...buildPublishContext(opts.session), enabledTools };
    tools = buildPublishTools(publishContext, resolveChatPublishAuthorization(opts.messages));
    try {
      const workspace = await prepareWorkspace(opts.session);
      tools = {
        ...buildReadTools({ repoId: repo.id, workdir: workspace.dir, diffRef: workspace.diffRef, enabledTools }),
        ...tools,
      };
    } catch (err) {
      log.warn(`工作区准备失败，本轮对话仅保留发布工具 session=${opts.session.id}`, err);
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
