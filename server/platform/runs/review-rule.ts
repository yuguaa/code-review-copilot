export const REVIEW_SCOPE_RULE = `审查范围约束（仅审查本次变更，非必要不扫描仓库）：
1. 以本次指定 base/head 之间的 diff 为审查范围，覆盖全部变更文件和变更代码块。仓库专项检查清单也仅用于本次变更，不得扩展为全仓扫描、架构盘点或历史问题排查。
2. 默认只使用 diff 和已有上下文。只有核实本次变更引入或加重的具体风险且证据不足时，才按明确的文件或符号定向读取最少量的相关定义、直接调用方、被调用方、类型或配置。限制搜索范围，证据充分后立即停止扩展，不得无目的地遍历目录、通读仓库或反复扫描无关代码。
3. 未修改的代码仅作为理解变更影响和核实问题的证据，不单独报告与本次变更无关的历史问题。减少扫描不得漏看本次变更，也不能省略必要的正确性、安全性和数据流验证。`;

const TOKEN_USAGE_RULE = `Token 使用约束（不得降低审查覆盖率）：
1. 先检查本次 diff 和已有上下文，只有证据不足时才搜索或读取文件；优先复用已经读取的内容和工具结果。
2. 对同一文件、同一调用链和同一事实只做一次有效验证，确认根因后停止重复搜索，不要为了扩大范围反复读取无关代码。
3. 不为格式、风格或与本次变更无关的历史代码消耗 Token；但影响正确性、安全性和数据流的必要验证不能省略。`;

export const DEFAULT_REVIEW_RULE = `${REVIEW_SCOPE_RULE}\n\n${TOKEN_USAGE_RULE}`;

const normalizeRule = (value: string) => value.replace(/\r\n?/g, '\n').replace(/\s+/g, ' ').trim();

export function withDefaultReviewRule(repositoryRule: string | null | undefined): string {
  const customRule = repositoryRule?.trim() ?? '';
  const normalized = normalizeRule(customRule);
  return [customRule, ...[REVIEW_SCOPE_RULE, TOKEN_USAGE_RULE].filter((rule) => !normalized.includes(normalizeRule(rule)))]
    .filter(Boolean).join('\n\n');
}
