export const DEFAULT_REVIEW_RULE = `Token 使用约束（不得降低审查覆盖率）：
1. 先检查本次 diff 和已有上下文，只有证据不足时才搜索或读取文件；优先复用已经读取的内容和工具结果。
2. 对同一文件、同一调用链和同一事实只做一次有效验证，确认根因后停止重复搜索，不要为了扩大范围反复读取无关代码。
3. 不为格式、风格或与本次变更无关的历史代码消耗 Token；但影响正确性、安全性和数据流的必要验证不能省略。`;

export function withDefaultReviewRule(repositoryRule: string | null | undefined): string {
  const customRule = repositoryRule?.trim() ?? '';
  if (!customRule) return DEFAULT_REVIEW_RULE;
  if (customRule.includes(DEFAULT_REVIEW_RULE)) return customRule;
  return `${customRule}\n\n${DEFAULT_REVIEW_RULE}`;
}
