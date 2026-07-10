import { streamText, stepCountIs, convertToModelMessages, type UIMessage } from 'ai';
import {
  loadActiveModelConfigs,
  loadGlobalDefaultModel,
  resolveModel,
  resolveReviewModelConfigs,
} from '../ai-models/ai-models.service';
import { buildReviewContext, buildTools } from './tools';
import { buildDelegateTools } from './subagents';
import { prepareWorkspace } from '../../infrastructure/workspace/workspace.service';
import type { SessionWithRepository } from '../sessions/session-message-store.service';
import { renderSkillInstructions, resolveRepositorySkills, type SkillState } from '../skills/skills.service';
import { resolveRepositoryTools } from '../tools/tools.service';
import { createLogger } from '../../shared/logger/logger.service';
import { createReviewBlueprint, renderReviewBlueprint, type ReviewBlueprint } from './review-blueprint';
import { createReviewRuntimeMemory, renderReviewRuntimeMemory, type ReviewRuntimeMemory } from './review-runtime-memory';
import type { ReviewActivityReporter } from './review-activity';

const log = createLogger('review-agent');
const delegateToolKeys = ['delegate_security', 'delegate_architecture', 'delegate_performance'] as const;

export function hasDelegateToolsAvailable(enabledTools: Set<string> | undefined, delegateModelCount: number): boolean {
  return delegateModelCount > 0 && (!enabledTools || delegateToolKeys.some((key) => enabledTools.has(key)));
}

/**
 * 组合审查 agent 系统提示词。仅服务 webhook 触发的首轮审查。
 * 输出渠道（平台评论/钉钉）按仓库配置动态生成：关闭的渠道不出现在指令里，agent 不会尝试调用不存在的工具。
 */
export function buildInstructions(
  repo: SessionWithRepository['repository'],
  skills: SkillState = [],
  blueprint?: ReviewBlueprint,
  runtimeMemory?: ReviewRuntimeMemory,
  options: { delegateToolsAvailable?: boolean } = {},
): string {
  const enableMrComment = repo?.enableMrComment ?? false;
  const enableDingtalk = repo?.enableDingtalk ?? false;
  const delegateToolsAvailable = options.delegateToolsAvailable ?? true;

  const tools = [
    '- bash：跑只读命令自由探索（grep/rg/find/cat/sed/git log/git show 等，支持管道；仅只读，不能写文件或联网）',
    '- read_file：读取任意文件完整内容',
    '- git_diff：查看本次审查变更（MR 为目标分支到当前 HEAD；Push 为 before 到 after）',
    '- read_memory：读取本仓库的项目记忆',
    '- record_evidence：把本轮已核验证据记录到运行期 CodeMem，供 verify loop 复核',
    delegateToolsAvailable ? '- delegate_security / delegate_architecture / delegate_performance：委派专项 agent 复核' : '',
  ].filter(Boolean).join('\n');

  const publish = enableMrComment
    ? '- 不要自行发布评论；系统会在 verify loop 通过后，把最终总评确定性发布到 MR 或 Push commit。\n'
    : '';
  const destination = enableDingtalk
    ? '会话页面展示与钉钉推送都取自这段文本，审查完成后系统会自动推送钉钉，你无需也无法自行发送通知。'
    : '审查结论会展示在会话页面，供团队查看与追问。';

  const base = `你是一名资深代码审查 Agent，工作在一个已 checkout 好的本地仓库工作区里——你的当前目录就是仓库根，可以像在本机一样自由探索整个代码库。

可用工具：
${tools}

工作方式（自主决定，不必拘泥顺序）：
- 先 read_memory 了解本项目既有约定、架构与历史问题。
- 只有项目记忆里的「用户反馈阈值沉淀」可作为长期依据；单次 findingFeedbacks 不是证据。把用户认可的问题模式作为重点复核方向，把用户否定的问题模式作为反例，除非本次变更有新的明确证据，否则不要机械复读。
- 本轮采用 DeepCode 风格链路：先遵循审查蓝图取证，再把已确认材料写入运行期 CodeMem，最后交给 verify loop 清洗。运行期 CodeMem 不是长期记忆。
- 用 git_diff 看本次变更，再用 bash/read_file 顺着变更自由追溯：搜调用方、看相关实现、查历史、核对约定。不要只盯着 diff 文本，要理解真实上下文。
- 聚焦真实问题：bug、安全风险、并发/边界、错误处理、破坏既有约定、明显的可维护性/性能问题。不堆砌琐碎风格意见。
${delegateToolsAvailable ? '- 按审查蓝图自行判断是否需要委派 subagents：只有蓝图中安全/架构/性能风险明确且复杂时才调用对应 delegate 工具；简单、低风险、证据已充分的变更不要为了形式委派。\n- delegate 返回的是独立复核材料，你必须二次判断并整合；不要原样搬运无法取证的专项结论。' : '- 当前没有启用的专项审查模型，本轮不提供 delegate 工具；你必须用主审查模型和只读工具完成取证。'}
- 对每条准备输出的问题，先调用 record_evidence 记录文件/行号/影响链路等已核验证据；未记录或无法取证的问题不要输出。

输出：
${publish}- 最后必须把完整的审查总评作为文本输出，按「严重/一般/建议」分组，每条给出 文件:行、问题、影响、修复建议。${destination}
- 没有实质问题时也必须输出「严重/一般/建议」三个分组，并分别明确写“未发现严重问题”“未发现一般问题”“暂无建议”。
- 不要写项目记忆；系统会在 verify loop 通过后，只把 verified 结论沉淀为后续审查依据。
- 你的输出会进入只读 verify loop；不要提前发布未经验证的结论。
- 全程用简体中文。`;

  const skillInstructions = renderSkillInstructions(skills);
  const custom = repo?.defaultReviewPrompt?.trim();
  return [
    base,
    blueprint ? renderReviewBlueprint(blueprint) : '',
    runtimeMemory ? renderReviewRuntimeMemory(runtimeMemory) : '',
    skillInstructions,
    custom ? `## 本仓库的额外审查要求\n${custom}` : '',
  ].filter(Boolean).join('\n\n');
}

/**
 * 创建一次审查的流式运行（仅 webhook 首轮审查走这里；追问对话见 chat-agent）。
 * 内部负责准备工作区（clone/fetch/worktree）并构造审查上下文。
 */
export async function createReviewStream(opts: {
  session: SessionWithRepository;
  messages: UIMessage[];
  abortSignal?: AbortSignal;
  onActivity?: ReviewActivityReporter;
}) {
  const repo = opts.session.repository;
  const [globalDefaultModel, activeModelConfigs] = await Promise.all([loadGlobalDefaultModel(), loadActiveModelConfigs()]);
  const modelConfigs = resolveReviewModelConfigs(repo, globalDefaultModel, activeModelConfigs);
  const model = resolveModel(modelConfigs.primary);
  const delegateModels = modelConfigs.delegates.map((config) => ({ config, model: resolveModel(config) }));
  const verifierModels = modelConfigs.verifiers.map((config) => ({ config, model: resolveModel(config) }));
  const primaryActivity = {
    id: 'primary',
    label: '主审查 Agent',
    provider: modelConfigs.primary.provider,
    modelId: modelConfigs.primary.modelId,
  };
  opts.onActivity?.({ ...primaryActivity, task: '准备代码工作区', status: 'running' }, 'preparing');
  const workspace = await prepareWorkspace(opts.session);
  if (!workspace.diffRef) throw new Error('会话缺少 diff 基准，无法执行审查');
  const ctx = await buildReviewContext(opts.session, workspace);
  const runtimeMemory = createReviewRuntimeMemory();
  ctx.runtimeMemory = runtimeMemory;
  const [enabledTools, skills] = repo
    ? await Promise.all([resolveRepositoryTools(repo.id), resolveRepositorySkills(repo.id)])
    : [undefined, [] as SkillState];
  if (enabledTools) ctx.enabledTools = enabledTools;
  const delegateToolsAvailable = hasDelegateToolsAvailable(enabledTools, delegateModels.length);
  opts.onActivity?.({ ...primaryActivity, task: '规划审查范围与风险路径', status: 'running' }, 'preparing');
  const blueprint = await createReviewBlueprint({
    ctx,
    model,
    maxSteps: Math.max(1, Math.min(modelConfigs.primary.maxSteps, 6)),
    abortSignal: opts.abortSignal,
  });
  opts.onActivity?.({ ...primaryActivity, task: '分析变更、调用工具并记录证据', status: 'running' }, 'reviewing');
  const tools = {
    ...buildTools(ctx, { publish: false, memoryWrite: false }),
    ...buildDelegateTools(ctx, delegateModels, opts.onActivity),
  };

  const stream = streamText({
    model,
    system: buildInstructions(repo, skills, blueprint, runtimeMemory, { delegateToolsAvailable }),
    messages: await convertToModelMessages(opts.messages),
    tools,
    stopWhen: stepCountIs(modelConfigs.primary.maxSteps),
    abortSignal: opts.abortSignal,
    onStepEnd: (step) => {
      if (!step.text?.trim() && step.toolCalls.length === 0) {
        log.warn('模型步骤无文本输出', {
          sessionId: opts.session.id,
          provider: modelConfigs.primary.provider,
          modelId: modelConfigs.primary.modelId,
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
        provider: modelConfigs.primary.provider,
        modelId: modelConfigs.primary.modelId,
        err: error,
      });
    },
  });
  return {
    stream,
    ctx,
    blueprint,
    runtimeMemory,
    primaryConfig: modelConfigs.primary,
    verifiers: verifierModels,
  };
}

export type ReviewRun = Awaited<ReturnType<typeof createReviewStream>>;
