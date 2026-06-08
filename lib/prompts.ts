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

/** 结构化审查 JSON 输出格式，供模型和解析器共享约束 */
export const REVIEW_JSON_OUTPUT_FORMAT = `
【输出格式】
只允许输出一个合法 JSON 对象，不要输出 Markdown、代码块或额外说明。

JSON Schema 语义如下：
{
  "conclusion": "一句话说明本文件/本轮变更的主要风险；无问题时写低风险结论",
  "comments": [
    {
      "filePath": "问题所在文件路径，必须来自输入",
      "lineNumber": 12,
      "lineRangeEnd": 15,
      "severity": "critical | normal | suggestion",
      "issue": "具体问题，必须可定位到当前 diff",
      "impact": "真实影响，不要泛泛而谈",
      "suggestion": "最短修复建议，必须可执行",
      "confidence": 0.86
    }
  ]
}

字段约束：
- comments 没有发现问题时返回空数组 []。
- severity 只能是 "critical"、"normal"、"suggestion"。
- lineNumber 必须是正整数；lineRangeEnd 无范围时可省略或为 null。
- 删除文件的问题必须使用输入 diff 的 old_path 作为 filePath，并使用删除侧旧行号。
- confidence 必须是 0 到 1 的数字，仅供系统内部排序和去重，不要在正文里提及。
- issue、impact、suggestion 必须是中文短句，不能为空。
- 不要为了凑数量输出不可定位、不可修复的问题。`

/** 系统提示词：定义 AI 角色和输出格式 */
export const SYSTEM_PROMPT = `你是一名专业代码审查助手。请仅针对代码变更进行审查。
【审查条件】
1. 这是一个公司内部项目，要求快速部署快速迭代
2. 不对外开放，包括代码内容外界无法访问，因此贡献指南，readme之类的开源项目关注的东西这里不需要。

【审查重点】
- 优先发现真实 bug、安全风险、异常路径、空值边界、状态不一致和性能退化。
- 一般问题必须能说明影响；建议类问题必须有明确收益。
- 只基于当前 diff 和输入上下文，不臆测未改动代码。
- 发现几条真实问题就输出几条，不限制严重问题数量。

除此之外的审查内容，可遵循仓库自定义提示词（如有）。

${REVIEW_JSON_OUTPUT_FORMAT}
`

/** 基础输出格式要求（用于替换模式，确保解析器可以正确解析） */
export const OUTPUT_FORMAT = `
【输出格式要求】
${REVIEW_JSON_OUTPUT_FORMAT}`

/** 全局复核提示词：补足逐文件审查难以发现的跨文件问题 */
export const GLOBAL_REVIEW_SYSTEM_PROMPT = `你是一名资深代码审查负责人。你已经拿到逐文件审查结果和所有文件 diff。
请只补充“跨文件、跨流程、整体设计或重复模式”层面的真实问题。

不要重复逐文件审查已经发现的问题。
不要输出无法定位到文件和行号的问题。
如果没有新增问题，返回 comments: []。

${REVIEW_JSON_OUTPUT_FORMAT}`

/** Agent Loop 规划提示词 */
export const REVIEW_AGENT_PLAN_SYSTEM_PROMPT = `你是一名代码审查 Agent 的规划器。
请基于 Code Graph、调用链上下文和 diff，输出一个合法 JSON 对象：
{
  "changeType": "变更类型",
  "riskLevel": "low | medium | high",
  "focusAreas": ["需要重点审查的方向"],
  "contextFiles": ["需要重点关注的文件路径"],
  "reviewStrategy": "简短审查策略",
  "needsMoreContext": false,
  "requestedTools": ["get_call_graph_neighbors"],
  "requestedAgentNames": ["需要调用的辅助 Agent 名称"],
  "additionalAgentTask": "委托给辅助 Agent 的具体审查任务"
}

约束：
- 不要输出 Markdown 或代码块。
- requestedTools 只能从 get_code_graph_status、get_memory_snapshot、get_changed_files、get_file_context、get_call_graph_neighbors、get_related_review_history、get_architecture_summary、rebuild_code_graph、run_additional_review_agents 中选择。
- 只有【可调用辅助 Agent】列表非空时，才能请求 run_additional_review_agents；如果列表为“无”，禁止请求该工具。
- 如果 Agent Tools 显示 Code Graph 缺失，优先请求 rebuild_code_graph，不要编造调用链结论。
- rebuild_code_graph 是系统触发的准备动作；只有工具观测显示 Code Graph 已可用后，才能基于调用链下结论。
- 如果已有上下文足够，needsMoreContext 必须为 false。
- 默认由当前 Agent 完成审查；只有需要其他专门审查 Agent 复核时，才把 run_additional_review_agents 放入 requestedTools。
- 调用 run_additional_review_agents 时必须填写 requestedAgentNames 和 additionalAgentTask；不要把辅助 Agent 当成默认并发流程。`

/** Agent Loop 结构化审查提示词 */
export const REVIEW_AGENT_REVIEW_SYSTEM_PROMPT = `你是一名代码审查 Agent。
请结合 Code Graph、调用链上下文、历史审查和本轮计划，只输出可定位、可修复的问题；confidence 仅作为 JSON 字段供系统内部使用。

审查范围：
- 可以发现跨文件、调用链和架构约束相关的问题。
- 不要重复已有问题。
- 不要输出无法定位到文件和行号的问题。

${REVIEW_JSON_OUTPUT_FORMAT}`

/** Agent Loop Critic 提示词 */
export const REVIEW_AGENT_CRITIC_SYSTEM_PROMPT = `你是一名代码审查 Critic。
请基于现有问题、上下文和预算，输出合法 JSON 对象：
{
  "shouldContinue": false,
  "reason": "停止或继续的原因",
  "newHighConfidenceFindings": 0,
  "duplicatesRemoved": 0,
  "memoryFacts": [
    {
      "type": "architecture | convention | risk | module | review_lesson",
      "content": "可写入 Code Graph 的历史事实",
      "confidence": 0.9,
      "evidence": "来自本次审查的证据"
    }
  ]
}

约束：
- 不要输出 Markdown 或代码块。
- 只有经过当前上下文验证、可复用的事实才放入 memoryFacts。
- 如果无新增问题或预算不足，shouldContinue 为 false。`

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
 * 构建全局复核提示词
 * @param params - 全局复核参数
 */
export function buildGlobalReviewPrompt(params: {
  title: string
  description?: string
  summary?: string
  files: Array<{ path: string; diff: string }>
  existingFindings: Array<{
    filePath: string
    lineNumber: number
    lineRangeEnd?: number | null
    severity: string
    content: string
  }>
}): string {
  const existingFindings = params.existingFindings.length > 0
    ? params.existingFindings
      .map((item) => {
        const location = item.lineRangeEnd
          ? `${item.filePath}:${item.lineNumber}-${item.lineRangeEnd}`
          : `${item.filePath}:${item.lineNumber}`
        return `- [${item.severity}] ${location} ${item.content}`
      })
      .join('\n')
    : '无'

  return [
    params.title ? `【变更主题】${params.title}` : '',
    params.summary ? `【概要】${params.summary}` : '',
    params.description ? `【描述】${params.description}` : '',
    `【变更文件】\n${params.files.map((file) => `- ${file.path}`).join('\n')}`,
    `【逐文件已发现问题】\n${existingFindings}`,
    `【全部 Diff】\n${params.files.map((file) => `### ${file.path}\n\`\`\`diff\n${file.diff}\n\`\`\``).join('\n\n')}`,
  ].filter(Boolean).join('\n\n')
}

/** 构建 Agent 规划提示词 */
export function buildReviewAgentPlanPrompt(params: {
  title: string
  description?: string | null
  changedFiles: string[]
  architectureSummary?: string
  toolCatalog?: Array<{ name: string; status: string; description: string; observation: string }>
  codeGraph?: {
    available: boolean
    status: string
    updateMode: string | null
    indexedFiles: number
    lastIndexedCommitSha: string | null
    previousIndexedCommitSha: string | null
    sourceCommitSha: string | null
    baseBranch: string | null
    baseCommitSha: string | null
    recommendation: string
  }
  contextSummary: string
  existingFindingsCount: number
  remainingIterations: number
  botName?: string
  botPrompt?: string | null
  botPromptMode?: string | null
  availableAdditionalAgents?: Array<{ name: string; description?: string | null; promptMode?: string | null }>
}): string {
  const additionalAgentsText = params.availableAdditionalAgents?.length
    ? `【可调用辅助 Agent】\n${params.availableAdditionalAgents.map((agent) => `- ${agent.name}${agent.description ? `：${agent.description}` : ''}；Prompt 模式：${agent.promptMode || 'extend'}`).join('\n')}`
    : '【可调用辅助 Agent】无'

  return [
    params.botName ? `【当前审查机器人】${params.botName}` : '',
    params.botPrompt ? `【机器人专属要求】\n${params.botPrompt}` : '',
    params.botPromptMode === 'replace' ? '【Prompt 模式】替换模式，请以机器人专属要求为最高审查准则。' : '',
    params.title ? `【变更主题】${params.title}` : '',
    params.description ? `【描述】${params.description}` : '',
    `【变更文件】\n${params.changedFiles.map((file) => `- ${file}`).join('\n')}`,
    params.codeGraph ? `【Code Graph 状态】\n可用：${params.codeGraph.available ? '是' : '否'}\n状态：${params.codeGraph.status}\n模式：${params.codeGraph.updateMode || 'unknown'}\n索引文件：${params.codeGraph.indexedFiles}\n基础分支：${params.codeGraph.baseBranch || 'none'}\n基础快照：${params.codeGraph.baseCommitSha || params.codeGraph.previousIndexedCommitSha || 'none'}\n当前快照：${params.codeGraph.lastIndexedCommitSha || 'unknown'}\n审查事件提交：${params.codeGraph.sourceCommitSha || 'unknown'}\n建议：${params.codeGraph.recommendation}` : '',
    params.toolCatalog?.length ? `【Agent Tools】\n${params.toolCatalog.map((tool) => `- ${tool.name} [${tool.status}]：${tool.description}；观测：${tool.observation}`).join('\n')}` : '',
    additionalAgentsText,
    `【项目架构摘要】\n${params.architectureSummary || '暂无'}`,
    `【当前上下文摘要】\n${params.contextSummary || '暂无'}`,
    `【已有问题数】${params.existingFindingsCount}`,
    `【剩余轮数】${params.remainingIterations}`,
  ].filter(Boolean).join('\n\n')
}

/** 构建 Agent Loop 审查提示词 */
export function buildReviewAgentReviewPrompt(params: {
  title: string
  description?: string | null
  changedFiles: string[]
  diffs: Array<{ filePath: string; diff: string }>
  plan: Record<string, unknown>
  contextSummary: string
  existingFindings: Array<{ filePath: string; lineNumber: number; severity: string; content: string; confidence?: number }>
  botName?: string
  botPrompt?: string | null
  botPromptMode?: string | null
}): string {
  const existingFindings = params.existingFindings.length > 0
    ? params.existingFindings.map((item) => `- [${item.severity}] ${item.filePath}:${item.lineNumber} ${item.content}`).join('\n')
    : '无'

  return [
    params.botName ? `【当前审查机器人】${params.botName}` : '',
    params.botPrompt ? `【机器人专属要求】\n${params.botPrompt}` : '',
    params.botPromptMode === 'replace' ? '【Prompt 模式】替换模式，请以机器人专属要求为最高审查准则。' : '',
    params.title ? `【变更主题】${params.title}` : '',
    params.description ? `【描述】${params.description}` : '',
    `【变更文件】\n${params.changedFiles.map((file) => `- ${file}`).join('\n')}`,
    `【Agent 审查计划】\n${JSON.stringify(params.plan, null, 2)}`,
    `【检索上下文】\n${params.contextSummary || '暂无'}`,
    `【已有问题】\n${existingFindings}`,
    `【Diff】\n${params.diffs.map((file) => `### ${file.filePath}\n\`\`\`diff\n${file.diff}\n\`\`\``).join('\n\n')}`,
  ].filter(Boolean).join('\n\n')
}

/** 构建 Agent Critic 提示词 */
export function buildReviewAgentCriticPrompt(params: {
  findings: Array<{ filePath: string; lineNumber: number; severity: string; content: string; confidence?: number }>
  contextSummary: string
  remainingIterations: number
}): string {
  const findings = params.findings.length > 0
    ? params.findings.map((item) => `- [${item.severity}] ${item.filePath}:${item.lineNumber} ${item.content}`).join('\n')
    : '无'

  return [
    `【当前问题】\n${findings}`,
    `【上下文摘要】\n${params.contextSummary || '暂无'}`,
    `【剩余轮数】${params.remainingIterations}`,
  ].join('\n\n')
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
    ? `Push 范围审查（从 ${params.baseCommitSha || 'unknown'} 到 ${params.headCommitSha || 'current'} 的完整变更）`
    : 'MR/Commit 全量审查（当前事件的完整变更）'

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
