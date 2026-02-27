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
请严格按以下顺序输出，且使用中文：
1. 结论行："结论: <一句话风险结论>"
2. 统计行："统计: 严重=<n> 一般=<n> 建议=<n>"
3. 若存在严重问题，输出小节标题："严重问题（最多2条）"
4. 每条严重问题必须是以下格式（单行）：
   - "- <filePath>:<line>[-<lineEnd>] 问题：...｜影响：...｜建议：..."
5. 若无严重问题，输出："未发现严重问题"
6. 可选输出“附加观察”1-3行（一般/建议的聚合描述，不需要逐行定位）

约束：
- 只基于当前 diff，不臆测未改动代码。
- 严重问题最多 2 条，优先高置信度且可直接修复的问题。
- 不要输出代码块，不要输出 JSON，不要添加多余前后缀说明。

除此之外的审查内容，可遵循仓库自定义提示词（如有）。
`

/** 基础输出格式要求（用于替换模式，确保解析器可以正确解析） */
export const OUTPUT_FORMAT = `
【输出格式要求】
必须包含统计行（完全匹配此格式）：统计: 严重=<n> 一般=<n> 建议=<n>`

/** 生成变更摘要专用系统提示词（不要求统计行） */
export const SUMMARY_SYSTEM_PROMPT = `你是一名专业的代码变更总结助手。
请基于用户提供的 diff，输出以下两部分（中文）：
1) 高层总结：2-4 句，说明本次改动做了什么、为什么做。
2) 技术走查：3-6 条，按“模块/文件 -> 关键改动 -> 可能影响”描述。

格式要求：
- 使用标题 "### 高层总结" 和 "### 技术走查"
- 技术走查使用短条目，每条尽量具体到文件或模块
- 不要输出统计行，不要列审查问题清单，不要输出代码块。`

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
  reviewScope?: 'full' | 'incremental'
  baseCommitSha?: string | null
  headCommitSha?: string
}): string {
  const scopeText = params.reviewScope === 'incremental'
    ? `增量审查（从 ${params.baseCommitSha || 'unknown'} 到 ${params.headCommitSha || 'current'}）`
    : '全量审查（MR/Commit 当前完整变更）'

  return `请按要求总结以下代码变更：

## ${params.title}
${params.description || ''}
审查范围：${scopeText}

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
