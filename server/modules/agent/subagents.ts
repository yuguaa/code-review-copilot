import { generateText, tool, stepCountIs, type LanguageModel } from 'ai';
import { z } from 'zod';
import { buildReadTools, type ReviewContext } from './tools';
import type { ToolKey } from '../tools/tools.service';
import { recordRuntimeEvidence } from './review-runtime-memory';

const RECON = '你工作在一个已 checkout 好的本地仓库（cwd 即仓库根），用 bash（grep/rg/find/cat/git log 等只读命令）、read_file、git_diff 在工作区自行取证。';

const SECURITY_INSTRUCTIONS = `你是安全专项代码审查 Agent。只关注安全风险：
注入（SQL/命令/路径）、认证与鉴权缺陷、越权/水平垂直权限、敏感信息泄露、不安全的反序列化/加密、SSRF/CSRF/XSS、依赖与配置风险。
${RECON}只报真实、可定位、可修复的安全问题，给出文件路径、行号、风险与修复建议。无安全问题就如实说明。用简体中文，输出精炼结论。`;

const ARCH_INSTRUCTIONS = `你是架构专项代码审查 Agent。只关注架构与可维护性：
模块边界与分层、循环依赖、职责单一、抽象是否合理、是否破坏既有约定、跨文件影响面、可扩展性与重复代码。
${RECON}只报真实、可定位的问题，给出文件路径与改进建议。无问题就如实说明。用简体中文，输出精炼结论。`;

const PERF_INSTRUCTIONS = `你是性能专项代码审查 Agent。只关注性能：
N+1 查询、不必要的循环/重复计算、阻塞 IO、内存泄漏、大对象拷贝、缓存缺失、前端重渲染/包体积。
${RECON}只报真实、可定位、影响明显的性能问题，给出文件路径、行号与优化建议。无问题就如实说明。用简体中文，输出精炼结论。`;

type SubagentSpec = {
  label: string;
  instructions: string;
  model: LanguageModel;
};

/**
 * 构造委派工具：把专项 subagent 包成主 agent 可调用的工具。
 * 主 agent 自主决定是否委派（取代旧版硬编码触发）。
 */
export function buildDelegateTools(ctx: ReviewContext, models: LanguageModel[]) {
  const enabled = ctx.enabledTools;
  if (models.length === 0) return {};
  const modelFor = (index: number) => {
    return models[index % models.length];
  };

  const delegate = (spec: SubagentSpec) =>
    tool({
      description: `委派${spec.label}专项 agent 独立复核本次变更，返回它的发现。当你判断变更涉及${spec.label}相关风险时调用。`,
      inputSchema: z.object({
        task: z.string().describe(`要${spec.label} agent 重点复核的内容（可附上你已知的变更范围）`),
      }),
      execute: async ({ task }, { abortSignal }) => {
        const r = await generateText({
          model: spec.model,
          system: spec.instructions,
          prompt: task,
          tools: buildReadTools(ctx), // subagent 只读，不发评论、不写记忆
          stopWhen: stepCountIs(8),
          abortSignal,
        });
        if (ctx.runtimeMemory) {
          recordRuntimeEvidence(ctx.runtimeMemory, {
            delegateFinding: `${spec.label}专项：${r.text.trim() || '未返回发现'}`,
          });
        }
        return r.text;
      },
    });

  const items: Array<[ToolKey, SubagentSpec]> = [
    ['delegate_security', { label: '安全', instructions: SECURITY_INSTRUCTIONS, model: modelFor(0) }],
    ['delegate_architecture', { label: '架构', instructions: ARCH_INSTRUCTIONS, model: modelFor(1) }],
    ['delegate_performance', { label: '性能', instructions: PERF_INSTRUCTIONS, model: modelFor(2) }],
  ];
  return Object.fromEntries(
    items
      .filter(([key]) => enabled?.has(key) ?? true)
      .map(([key, spec]) => [key, delegate(spec)]),
  );
}
