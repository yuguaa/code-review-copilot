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
  repositoryCount: number; rssSubscriptionCount: number;
};
export type GitLabAccount = { id: string; url: string; isActive: boolean; hasAccessToken: boolean; hasWebhookSecret: boolean };
export type RssSubscriptionItem = {
  id: string; name: string; url: string; enabled: boolean; intervalMinutes: number; dingtalkRobotId: string | null;
  lastFetchedAt: string | null; lastError: string | null; pushedCount: number;
};
