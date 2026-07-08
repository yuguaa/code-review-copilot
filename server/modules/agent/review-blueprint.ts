import { generateText, stepCountIs, type LanguageModel } from 'ai';
import { buildReadTools, type ReviewContext } from './tools';

export type ReviewBlueprint = {
  scope: string[];
  riskAreas: string[];
  requiredEvidence: string[];
  delegatePlan: string[];
  verificationChecklist: string[];
};

export const BLUEPRINT_INSTRUCTIONS = `你是代码审查 blueprint agent。你的任务不是下结论，而是把本次变更压缩成后续审查可执行的取证蓝图。

工作要求：
- 只能基于只读工具取证：read_memory、git_diff、read_file、bash。
- 先读取项目记忆与 git_diff，再判断本次变更的真实范围。
- 只把「用户反馈阈值沉淀」当作长期依据；单次 findingFeedbacks 不是证据。
- 判断是否需要 subagents：只有安全、架构、性能风险明确且复杂时才建议委派。
- 输出必须是纯 JSON，不要 Markdown，不要解释。

JSON 结构：
{
  "scope": ["本次变更涉及的模块/文件范围"],
  "riskAreas": ["需要重点复核的风险假设"],
  "requiredEvidence": ["后续必须取得的证据，例如调用方、配置、边界条件、历史约定"],
  "delegatePlan": ["需要委派的专项：security / architecture / performance；不需要则为空数组"],
  "verificationChecklist": ["verify loop 必须逐条核验的标准"]
}`;

const EMPTY_BLUEPRINT: ReviewBlueprint = {
  scope: [],
  riskAreas: [],
  requiredEvidence: [],
  delegatePlan: [],
  verificationChecklist: [],
};

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

export function parseReviewBlueprint(text: string): ReviewBlueprint {
  const json = text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return {
      scope: arrayOfStrings(parsed.scope),
      riskAreas: arrayOfStrings(parsed.riskAreas),
      requiredEvidence: arrayOfStrings(parsed.requiredEvidence),
      delegatePlan: arrayOfStrings(parsed.delegatePlan),
      verificationChecklist: arrayOfStrings(parsed.verificationChecklist),
    };
  } catch {
    return EMPTY_BLUEPRINT;
  }
}

export function renderReviewBlueprint(blueprint: ReviewBlueprint): string {
  const list = (items: string[]) => (items.length ? items.map((item) => `- ${item}`).join('\n') : '- 暂无');
  return [
    '## 审查蓝图',
    '这份蓝图用于约束主审查和 verify loop，不能替代实际代码取证。',
    '### 变更范围',
    list(blueprint.scope),
    '### 风险假设',
    list(blueprint.riskAreas),
    '### 必须取得的证据',
    list(blueprint.requiredEvidence),
    '### Subagents 委派计划',
    list(blueprint.delegatePlan),
    '### Verify 核验清单',
    list(blueprint.verificationChecklist),
  ].join('\n');
}

export function createReviewBlueprint({
  ctx,
  model,
  maxSteps,
  abortSignal,
}: {
  ctx: ReviewContext;
  model: LanguageModel;
  maxSteps: number;
  abortSignal?: AbortSignal;
}): Promise<ReviewBlueprint> {
  return generateText({
    model,
    system: BLUEPRINT_INSTRUCTIONS,
    prompt: '请为本次代码审查生成 DeepCode 风格的审查蓝图。',
    tools: buildReadTools(ctx),
    stopWhen: stepCountIs(Math.max(1, Math.min(maxSteps, 6))),
    abortSignal,
  }).then((result) => parseReviewBlueprint(result.text));
}
