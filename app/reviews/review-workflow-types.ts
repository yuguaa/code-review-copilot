export type ReviewWorkflowNode = {
  id: string
  nodeKey: string
  parentNodeKey: string | null
  kind: string
  status: string
  title: string
  summary: string | null
  detail: string | null
  sequence: number
  startedAt: string | null
  completedAt: string | null
  durationMs: number | null
  metricsJson: unknown
  rawJson: unknown
  reviewBotRunId: string | null
  createdAt: string
  updatedAt: string
}

export type ReviewWorkflowEdge = {
  id: string
  source: string
  target: string
  label?: string
  kind: 'main' | 'parent' | 'agent' | 'loop'
}

export type ReviewWorkflowSnapshot = {
  reviewStatus: string
  updatedAt: string
  nodes: ReviewWorkflowNode[]
  edges: ReviewWorkflowEdge[]
}

export type WorkflowIssue = {
  id: string
  reviewBotRunId?: string | null
  filePath: string
  lineNumber: number
  lineRangeEnd?: number | null
  severity: string
  content: string
  gitlabDiffUrl?: string | null
}

export const reviewWorkflowKindLabels: Record<string, string> = {
  trigger: '触发',
  diff: 'Diff',
  memory: 'Memory',
  summary: '摘要',
  agent: 'Agent',
  decision: '决策',
  iteration_stage: 'Loop',
  aggregate: '聚合',
  publish: '发布',
  finish: '结束',
}

export function compactWorkflowText(value: string | null | undefined, maxLength: number) {
  const normalized = value?.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`
}

export function getWorkflowNodeMessage(node: ReviewWorkflowNode) {
  if (node.status === 'failed') {
    return node.summary || '步骤执行失败'
  }
  if (node.status === 'running') {
    return node.summary || node.detail || '正在执行'
  }
  return node.summary || node.detail || '状态已更新'
}
