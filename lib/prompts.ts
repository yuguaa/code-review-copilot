/**
 * @file prompts.ts
 * @description 代码审查 AI 提示词管理模块
 *
 * 包含系统提示词、输出格式定义、以及构建用户提示词的工具函数。
 * 只包含通用的系统级配置，具体的审查内容由调用时动态传入。
 */

/** 问题严重等级枚举 */
export const SEVERITY = {
  CRITICAL: '严重',
  NORMAL: '一般',
  SUGGESTION: '建议',
} as const

/** 系统提示词：定义 AI 角色和输出格式 */
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

/** 基础输出格式要求（用于替换模式，确保解析器可以正确解析） */
export const OUTPUT_FORMAT = `
【输出格式要求】
每条问题单独列出，格式如下：
行号: [严重/一般/建议] 问题描述`

/**
 * 构建代码审查提示词
 * @param params - 审查参数
 * @param params.title - 变更主题（MR 标题或 commit message）
 * @param params.description - 变更描述
 * @param params.filename - 文件名
 * @param params.diff - diff 内容
 * @param params.summary - 变更概要
 */
export function buildReviewPrompt(params: {
  title: string
  description?: string
  filename: string
  diff: string
  summary?: string
}): string {
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

/**
 * 构建总结提示词
 * @param params - 总结参数
 * @param params.title - 变更主题
 * @param params.description - 变更描述
 * @param params.diffs - 所有 diff 内容
 */
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

/**
 * 构建批量审查提示词（用于审查大量文件时生成总结性评论）
 * @param params - 批量审查参数
 */
export function buildBatchReviewPrompt(params: {
  title: string
  description?: string
  files: Array<{ path: string; diff: string }>
  fileCount: number
}): string {
  const fileSummary = params.files.map(f => `- ${f.path}`).join('\n')

  return `你是一名专业代码审查助手。请对以下 ${params.fileCount} 个文件的代码变更进行审查。

【变更主题】${params.title}
${params.description ? `【描述】${params.description}\n` : ''}

【变更文件列表】
${fileSummary}

【审查要求】
1. 这是一个公司内部项目，要求快速部署快速迭代
2. 不对外开放，包括代码内容外界无法访问
3. 请重点关注：代码质量、潜在 bug、安全问题、性能问题
4. 对于每个文件，给出具体的行号和问题描述
5. 按文件分组输出结果

【输出格式】
## 文件名
行号: [严重/一般/建议] 问题描述

（如果没有问题，回复：LGTM!）

【代码变更】
${params.files.map(f => `
### ${f.path}
\`\`\`diff
${f.diff}
\`\`\``).join('\n')}`
}
