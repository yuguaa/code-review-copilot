import { describe, expect, it } from "vitest";

import { DEFAULT_REVIEW_RULE, withDefaultReviewRule } from "./review-rule";

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
});
