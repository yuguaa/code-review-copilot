import { describe, expect, it } from "vitest";

import { DEFAULT_REVIEW_RULE, REVIEW_SCOPE_RULE, withDefaultReviewRule } from "./review-rule";

const legacyTokenRule = `Token 使用约束（不得降低审查覆盖率）：
1. 先检查本次 diff 和已有上下文，只有证据不足时才搜索或读取文件；优先复用已经读取的内容和工具结果。
2. 对同一文件、同一调用链和同一事实只做一次有效验证，确认根因后停止重复搜索，不要为了扩大范围反复读取无关代码。
3. 不为格式、风格或与本次变更无关的历史代码消耗 Token；但影响正确性、安全性和数据流的必要验证不能省略。`;

describe("默认审查规则", () => {
  it("仓库规则为空时使用平台默认规则", () => {
    expect(withDefaultReviewRule(null)).toBe(DEFAULT_REVIEW_RULE);
    expect(withDefaultReviewRule("  ")).toBe(DEFAULT_REVIEW_RULE);
  });

  it("保留仓库专项规则并追加默认规则", () => {
    expect(withDefaultReviewRule("只审查前端变更")).toBe(`只审查前端变更\n\n${DEFAULT_REVIEW_RULE}`);
  });

  it("已经包含默认规则时不重复追加", () => {
    const rule = `仓库规则\n\n${DEFAULT_REVIEW_RULE}`;
    expect(withDefaultReviewRule(rule)).toBe(rule);
  });

  it("默认规则存在换行或空白差异时不重复追加", () => {
    const rule = `仓库规则\r\n\r\n${DEFAULT_REVIEW_RULE.replace(/\n/g, "  \r\n")}`;
    expect(withDefaultReviewRule(rule)).toBe(rule);
  });

  it("已有旧版 Token 规则时只补充变更范围约束", () => {
    const rule = `仓库专项规则\n\n${legacyTokenRule}`;
    expect(withDefaultReviewRule(rule)).toBe(`${rule}\n\n${REVIEW_SCOPE_RULE}`);
  });

  it("线上仓库已包含范围约束时不重复追加", () => {
    const rule = `仓库专项规则\n\n${REVIEW_SCOPE_RULE}`;
    const merged = withDefaultReviewRule(rule);
    expect(merged).toBe(`${rule}\n\n${legacyTokenRule}`);
    expect(withDefaultReviewRule(merged)).toBe(merged);
  });

  it("旧版规则存在换行差异时仍按段去重", () => {
    const rule = `仓库专项规则\r\n\r\n${legacyTokenRule.replace(/\n/g, '  \r\n')}`;
    expect(withDefaultReviewRule(rule)).toBe(`${rule}\n\n${REVIEW_SCOPE_RULE}`);
  });
});
