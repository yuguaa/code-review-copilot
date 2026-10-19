import type { UIMessage } from 'ai';

export type RunStatus = 'queued' | 'running' | 'cancelling' | 'completed' | 'partial' | 'skipped' | 'failed' | 'cancelled' | 'interrupted';
export type Delivery = { status: string; error?: string; remoteIds?: string[]; startedAt?: string; finishedAt?: string };
export type ReviewRun = {
  id: string; sessionId: string; repositoryId: string | null;
  triggerType: string; engineKey: string; engineVersion: string | null; status: RunStatus;
  baseSha: string | null; startSha: string | null; headSha: string | null;
  provider: string | null; modelId: string | null; traceId: string | null; error: string | null;
  createdAt?: string; startedAt: string | null; finishedAt: string | null;
  deliveries: Partial<Record<'gitlab' | 'dingtalk', Delivery>>; reportMessageId: string | null;
  repository?: { id: string; name: string; path: string } | null;
  session?: { title: string | null; mrIid: number | null };
};
export type MessageTreeNode = {
  id: string; parentId: string | null; role: UIMessage['role']; createdAt: string;
  siblingIds: string[]; siblingIndex: number; siblingCount: number; active: boolean;
};
export type SessionListItem = {
  id: string; kind: string; title: string | null; status: string; mrIid: number | null;
  sourceBranch: string | null; targetBranch: string | null;
  repository: { name: string; path: string; webUrl?: string | null } | null;
  webUrl?: string | null; createdAt: string; updatedAt: string; preview: string;
};
export type SessionDetail = {
  session: {
    id: string; kind: string; title: string | null; status: string;
    mrIid: number | null; mrTitle: string | null; sourceBranch: string | null; targetBranch: string | null;
    commitSha: string | null; author: string | null; error: string | null; updatedAt: string;
    repository: { id: string; name: string; path: string; webUrl?: string | null } | null;
    webUrl?: string | null;
  };
  runs: ReviewRun[]; messages: UIMessage[]; messageTree: MessageTreeNode[];
  activeLeafMessageId: string | null; activePathIds: string[];
};
export type AIModelSummary = {
  id: string; provider: string; modelId: string; apiBaseUrl: string | null;
  isDefault: boolean; isActive: boolean; maxSteps: number; hasApiKey: boolean;
};
export type RepositoryItem = { id: string; name: string; path: string };
export type Repository = RepositoryItem & {
  isActive: boolean;
  gitLabAccountId: string; gitLabProjectId: number; watchBranches: string | null; autoReview: boolean;
  defaultAIModelId: string | null; defaultAIModel: AIModelSummary | null;
  customProvider: string | null; customModelId: string | null; customApiBaseUrl: string | null;
  customMaxSteps: number | null; hasCustomApiKey: boolean; defaultReviewPrompt: string | null;
  ocrConcurrency: number; ocrTimeoutMinutes: number; ocrMaxTokensBudget: number;
  enableMrComment: boolean; enableDingtalk: boolean; dingtalkRobotId: string | null;
};
export type DingtalkRobot = {
  id: string; name: string; enabled: boolean; hasWebhookUrl: boolean; hasSecret: boolean;
  repositoryCount: number; rssSubscriptionCount: number; securityTargetCount: number;
};
export type GitLabAccount = { id: string; url: string; isActive: boolean; hasAccessToken: boolean; hasWebhookSecret: boolean };
export type RssSubscriptionItem = {
  id: string; name: string; url: string; enabled: boolean; intervalMinutes: number; dingtalkRobotId: string | null;
  lastFetchedAt: string | null; lastError: string | null; pushedCount: number;
};

export type SecurityTarget = {
  id: string;
  repositoryId: string | null;
  name: string;
  baseUrl: string;
  scopeDomains: string[];
  authorizationOwner: string;
  authorizationReference: string;
  authorizedUntil: string;
  scheduleEnabled: boolean;
  scheduleIntervalMinutes: number;
  nextScheduledAt: string | null;
  lastScheduledAt: string | null;
  isActive: boolean;
  maxDurationMinutes: number;
  defaultAIModelId: string | null;
  dingtalkRobotId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SecurityIdentity = {
  id: string;
  targetId: string;
  name: string;
  role: string;
  username: string;
  hasPassword: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SecurityTicketStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type SecurityFinding = {
  id: string;
  ticketId: string;
  executionId: string | null;
  fingerprint: string;
  category: string | null;
  severity: SecuritySeverity;
  confidence: string;
  title: string;
  description: string;
  evidence: string;
  remediation: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type SecurityExecution = {
  id: string;
  ticketId: string;
  status: string;
  agentSessionId: string | null;
  traceId: string | null;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  rawResult: unknown;
};

export type SecurityTraffic = {
  id: string;
  ticketId: string;
  executionId: string | null;
  method: string;
  url: string;
  statusCode: number | null;
  bodyPreview: string | null;
  contentHash: string | null;
  durationMs: number;
  createdAt: string;
};

export type SecurityArtifact = {
  id: string;
  ticketId: string;
  executionId: string | null;
  type: string;
  filename: string;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
  createdAt: string;
};

export type SecurityEvent = {
  id: string;
  ticketId: string;
  executionId: string | null;
  type: string;
  message: string;
  data: unknown;
  createdAt: string;
};

export type SecurityTicketSummary = {
  id: string;
  targetId: string;
  triggerType: string;
  status: SecurityTicketStatus;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  summary: string | null;
  riskScore: number | null;
  modelProvider: string | null;
  modelId: string | null;
  skillVersion: string | null;
  createdAt: string;
  updatedAt: string;
  target: SecurityTarget;
};

export type SecurityTicketDetail = SecurityTicketSummary & {
  report: string | null;
  executions: SecurityExecution[];
  findings: SecurityFinding[];
  traffic: SecurityTraffic[];
  artifacts: SecurityArtifact[];
  events: SecurityEvent[];
};
