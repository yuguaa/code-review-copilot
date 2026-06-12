/**
 * @file prompts.ts
 * @description Pi 审查输出约束
 */

/** 问题严重等级枚举 */
export const SEVERITY = {
  CRITICAL: "严重",
  NORMAL: "一般",
  SUGGESTION: "建议",
} as const;

/** Pi 审查 JSON 输出格式，供运行时 prompt 与解析器共享约束 */
export const PI_REVIEW_JSON_OUTPUT_FORMAT = `
【输出格式】
只允许输出一个合法 JSON 对象，不要输出 Markdown、代码块或额外说明。

JSON Schema 语义如下：
{
  "summary": "一句话说明本轮变更的主要风险；无问题时写低风险结论",
  "findings": [
    {
      "filePath": "问题所在文件路径，必须来自输入",
      "lineNumber": 12,
      "lineRangeEnd": 15,
      "severity": "critical | normal | suggestion",
      "content": "问题、影响、建议合并成一段中文短句，必须可定位、可行动",
      "confidence": 0.86
    }
  ]
}

字段约束：
- findings 没有发现问题时返回空数组 []。
- severity 只能是 "critical"、"normal"、"suggestion"。
- lineNumber 必须是正整数；lineRangeEnd 无范围时可省略或为 null。
- confidence 必须是 0 到 1 的数字，仅供系统内部排序和去重，不要在正文里提及。
- content 必须是中文短句，不能为空。
- 不要为了凑数量输出不可定位、不可修复的问题。`;
