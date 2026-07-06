import type { UIMessage } from 'ai';

export type SessionListItem = {
  id: string;
  kind: string;
  title: string | null;
  status: string;
  mrIid: number | null;
  sourceBranch: string | null;
  targetBranch: string | null;
  repository: { name: string; path: string; webUrl?: string | null } | null;
  webUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  preview: string;
};

export type SessionDetail = {
  session: {
    id: string;
    kind: string;
    title: string | null;
    status: string;
    mrIid: number | null;
    mrTitle: string | null;
    sourceBranch: string | null;
    targetBranch: string | null;
    commitSha: string | null;
    author: string | null;
    error: string | null;
    updatedAt: string;
    repository: { id: string; name: string; path: string; webUrl?: string | null } | null;
    webUrl?: string | null;
  };
  messages: UIMessage[];
  messageTree: MessageTreeNode[];
  activeLeafMessageId: string | null;
  activePathIds: string[];
};

export type MessageTreeNode = {
  id: string;
  parentId: string | null;
  role: UIMessage['role'];
  createdAt: string;
  siblingIds: string[];
  siblingIndex: number;
  siblingCount: number;
  active: boolean;
};

export type MessageFeedbackValue = 'up' | 'down';

export type MessageFindingFeedback = {
  text: string;
  feedback: MessageFeedbackValue;
  feedbackAt?: string;
};

export type RepositoryItem = {
  id: string;
  name: string;
  path: string;
};

export type AgentToolItem = {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  defaultEnabled: boolean;
  builtin?: boolean;
  isActive?: boolean;
  enabled?: boolean;
};

export type AgentSkillItem = {
  id: string;
  key: string;
  name: string;
  description: string;
  mode: string;
  defaultEnabled: boolean;
  builtin?: boolean;
  isActive?: boolean;
  enabled?: boolean;
};
