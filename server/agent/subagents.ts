import { ToolLoopAgent, tool, stepCountIs, type LanguageModel } from 'ai';
import { z } from 'zod';
import { buildReadTools, type ReviewContext } from './tools';

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

function makeSubagent(model: LanguageModel, instructions: string, ctx: ReviewContext) {
  return new ToolLoopAgent({
    model,
    instructions,
    tools: buildReadTools(ctx), // subagent 只读，不发评论
    stopWhen: stepCountIs(8),
  });
}

type ReadSubagent = ReturnType<typeof makeSubagent>;

/**
 * 构造委派工具：把专项 subagent 包成主 agent 可调用的工具。
 * 主 agent 自主决定是否委派（取代旧版硬编码触发）。
 */
export function buildDelegateTools(ctx: ReviewContext, model: LanguageModel) {
  const security = makeSubagent(model, SECURITY_INSTRUCTIONS, ctx);
  const architecture = makeSubagent(model, ARCH_INSTRUCTIONS, ctx);
  const performance = makeSubagent(model, PERF_INSTRUCTIONS, ctx);

  const delegate = (agent: ReadSubagent, label: string) =>
    tool({
      description: `委派${label}专项 agent 独立复核本次变更，返回它的发现。当你判断变更涉及${label}相关风险时调用。`,
      inputSchema: z.object({
        task: z.string().describe(`要${label} agent 重点复核的内容（可附上你已知的变更范围）`),
      }),
      execute: async ({ task }, { abortSignal }) => {
        const r = await agent.generate({ prompt: task, abortSignal });
        return r.text;
      },
    });

  return {
    delegate_security: delegate(security, '安全'),
    delegate_architecture: delegate(architecture, '架构'),
    delegate_performance: delegate(performance, '性能'),
  };
}
