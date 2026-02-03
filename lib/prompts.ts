/**
 * 代码审查系统提示词
 * 只包含通用的系统级配置，具体的审查内容由调用时动态传入
 */

// 问题严重等级
export const SEVERITY = {
  CRITICAL: '严重',  // 安全漏洞、重大 Bug、性能问题
  NORMAL: '一般',    // 代码质量、小 Bug
  SUGGESTION: '建议', // 最佳实践、优化建议
} as const

// 系统提示词：定义 AI 角色和输出格式
export const SYSTEM_PROMPT = `你是一名专业代码审查助手。请仅针对代码变更，逐行指出具体、可操作的问题。
【审查条件】
1. 这是一个公司内部项目，要求快速部署快速迭代
2. 不对外开放，包括代码内容外界无法访问，因此贡献指南，readme之类的开源项目关注的东西这里不需要。

【输出要求】
1. 每条问题单独列出，格式如下：
  行号: [严重/一般/建议] 问题描述
2. 只输出真实存在的问题，避免泛泛而谈。
3. 没有问题时，仅回复：LGTM!
4. 回复务必简洁、直接、中文。

【示例】
12: [一般] 变量命名不规范，建议使用驼峰命名
25: [严重] 存在 SQL 注入风险，建议参数化查询
`

// 构建审查提示词
export function buildReviewPrompt(params: {
  title: string
  description?: string
  filename: string
  diff: string
  summary?: string
}): string {
  // 精简版审查提示词，突出变更上下文和 diff
  // customPrompt 现在在系统提示词中处理（支持 replace/extend 模式）
  const parts = [
    params.title ? `【变更主题】${params.title}` : '',
    params.summary ? `【概要】${params.summary}` : '',
    params.description ? `【描述】${params.description}` : '',
    `【文件】${params.filename}`,
    '```diff',
    params.diff,
    '```',
  ]
  return parts.filter(Boolean).join('\n')
}

// 构建总结提示词
export function buildSummaryPrompt(params: {
  title: string
  description?: string
  diffs: string
}): string {
  return `请简要总结以下代码变更（100字以内）：

## ${params.title}
${params.description || ''}

\`\`\`diff
${params.diffs}
\`\`\``
}
