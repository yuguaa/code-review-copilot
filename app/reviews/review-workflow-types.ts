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
