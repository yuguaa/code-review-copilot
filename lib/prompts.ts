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
export const SYSTEM_PROMPT = `你是一名专业代码审查助手。请仅针对代码变更进行审查。
【审查条件】
1. 这是一个公司内部项目，要求快速部署快速迭代
2. 不对外开放，包括代码内容外界无法访问，因此贡献指南，readme之类的开源项目关注的东西这里不需要。

【输出要求】
1. 直接列出发现的问题，按严重程度分类（严重、一般、建议）
2. 每个问题包含：位置（行号）、问题描述、建议修改方式
3. 如果没有发现问题，输出 "未发现明显问题"
4. 不要输出统计信息（如"严重=1 一般=2"等）

除此之外的审查风格/格式，请遵循仓库自定义提示词（如有）。若未提供自定义提示词，请尽量简洁输出。
`

/** 基础输出格式要求（用于替换模式，确保解析器可以正确解析） */
export const OUTPUT_FORMAT = `
【输出格式要求】
必须包含统计行（完全匹配此格式）：统计: 严重=<n> 一般=<n> 建议=<n>`

/** 生成变更摘要专用系统提示词（不要求统计行） */
export const SUMMARY_SYSTEM_PROMPT = `你是一名专业的代码变更总结助手。
请基于用户提供的 diff，总结本次变更的目的与影响面（2-4 句，中文，尽量具体），不要输出统计行、不要列问题清单。`

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

  return `请基于以下代码变更进行审查（${params.fileCount} 个文件）。请遵循系统提示词中的“总结优先 + 统计 + 仅展开严重问题”的输出要求。

【变更主题】${params.title}
${params.description ? `【描述】${params.description}\n` : ''}

【变更文件列表】
${fileSummary}

【代码变更】
${params.files.map(f => `
### ${f.path}
\`\`\`diff
${f.diff}
\`\`\``).join('\n')}`
}
