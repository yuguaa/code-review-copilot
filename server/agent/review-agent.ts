import { streamText, stepCountIs, convertToModelMessages, type UIMessage } from 'ai';
import { loadGlobalDefaultModel, resolveModel, resolveRepositoryModelConfig } from '../modules/ai-models/ai-models.service';
import { buildReviewContext, buildTools } from './tools';
import { buildDelegateTools } from './subagents';
import { prepareWorkspace } from '../infrastructure/workspace/workspace.service';
import type { SessionWithRepository } from '../modules/sessions/session-message-store.service';
import { renderSkillInstructions, resolveRepositorySkills, type SkillState } from '../modules/skills/skills.service';
import { resolveRepositoryTools } from '../modules/tools/tools.service';
import { createLogger } from '../shared/logger/logger.service';

const log = createLogger('review-agent');

/**
 * 组合审查 agent 系统提示词。仅服务 webhook 触发的首轮审查。
 * 输出渠道（平台评论/钉钉）按仓库配置动态生成：关闭的渠道不出现在指令里，agent 不会尝试调用不存在的工具。
 */
export function buildInstructions(repo: SessionWithRepository['repository'], skills: SkillState = []): string {
  const enableMrComment = repo?.enableMrComment ?? false;
  const enableDingtalk = repo?.enableDingtalk ?? false;

  const tools = [
    '- bash：跑只读命令自由探索（grep/rg/find/cat/sed/git log/git show 等，支持管道；仅只读，不能写文件或联网）',
    '- read_file：读取任意文件完整内容',
    '- git_diff：查看本次审查变更（MR 为目标分支到当前 HEAD；Push 为 before 到 after）',
    '- read_memory / write_memory：读取与沉淀本仓库的项目记忆',
    ...(enableMrComment ? ['- post_review_comment / post_inline_comment：把总评与行级问题发布到 MR 或 Push commit'] : []),
    '- delegate_security / delegate_architecture / delegate_performance：委派专项 agent 复核',
  ].join('\n');

  const publish = enableMrComment
    ? '- 行级问题用 post_inline_comment 精准贴到对应文件行；整体结论用 post_review_comment 发一条总评。MR 会发布到 MR，Push 会发布到本次提交。\n'
    : '';
  const destination = enableDingtalk
    ? '会话页面展示与钉钉推送都取自这段文本，审查完成后系统会自动推送钉钉，你无需也无法自行发送通知。'
    : '审查结论会展示在会话页面，供团队查看与追问。';

  const base = `你是一名资深代码审查 Agent，工作在一个已 checkout 好的本地仓库工作区里——你的当前目录就是仓库根，可以像在本机一样自由探索整个代码库。

可用工具：
${tools}

工作方式（自主决定，不必拘泥顺序）：
- 先 read_memory 了解本项目既有约定、架构与历史问题。
- 用 git_diff 看本次变更，再用 bash/read_file 顺着变更自由追溯：搜调用方、看相关实现、查历史、核对约定。不要只盯着 diff 文本，要理解真实上下文。
- 聚焦真实问题：bug、安全风险、并发/边界、错误处理、破坏既有约定、明显的可维护性/性能问题。不堆砌琐碎风格意见。
- 涉及安全/架构/性能的复杂变更，按需委派对应专项 agent 复核，并把其发现整合进结论。按变更性质判断，不无脑全委派。

输出：
${publish}- 最后必须把完整的审查总评作为文本输出，按「严重/一般/建议」分组，每条给出 文件:行、问题、影响、修复建议。${destination}
- 没有实质问题就如实说明，不编造。
- 审查结束后，把本次得到的、对后续审查有用的项目认知用 write_memory 沉淀（增量更新，保留既有记忆里仍有效的内容）。
- 全程用简体中文。`;

  const skillInstructions = renderSkillInstructions(skills);
  const custom = repo?.defaultReviewPrompt?.trim();
  return [base, skillInstructions, custom ? `## 本仓库的额外审查要求\n${custom}` : ''].filter(Boolean).join('\n\n');
}

/**
 * 创建一次审查的流式运行（仅 webhook 首轮审查走这里；追问对话见 chat-agent）。
 * 内部负责准备工作区（clone/fetch/worktree）并构造审查上下文。
 */
export async function createReviewStream(opts: { session: SessionWithRepository; messages: UIMessage[] }) {
  const repo = opts.session.repository;
  const globalDefaultModel = await loadGlobalDefaultModel();
  const modelConfig = resolveRepositoryModelConfig(repo, globalDefaultModel);
  const model = resolveModel(modelConfig);
  const workspace = await prepareWorkspace(opts.session);
  if (!workspace.diffRef) throw new Error('会话缺少 diff 基准，无法执行审查');
  const ctx = await buildReviewContext(opts.session, workspace);
  const [enabledTools, skills] = repo
    ? await Promise.all([resolveRepositoryTools(repo.id), resolveRepositorySkills(repo.id)])
    : [undefined, [] as SkillState];
  if (enabledTools) ctx.enabledTools = enabledTools;
  const tools = { ...buildTools(ctx), ...buildDelegateTools(ctx, model) };

  return streamText({
    model,
    system: buildInstructions(repo, skills),
    messages: await convertToModelMessages(opts.messages),
    tools,
    stopWhen: stepCountIs(modelConfig.maxSteps),
    onStepEnd: (step) => {
      if (!step.text?.trim() && step.toolCalls.length === 0) {
        log.warn('模型步骤无文本输出', {
          sessionId: opts.session.id,
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
        provider: modelConfig.provider,
        modelId: modelConfig.modelId,
        err: error,
      });
    },
  });
}
