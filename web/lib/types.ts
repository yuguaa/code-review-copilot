import type { UIMessage } from 'ai';

export type SessionListItem = {
  id: string;
  kind: string;
  title: string | null;
  status: string;
  mrIid: number | null;
  sourceBranch: string | null;
  targetBranch: string | null;
  repository: { name: string; path: string } | null;
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
    repository: { id: string; name: string; path: string } | null;
  };
  messages: UIMessage[];
};

export type RepositoryItem = {
  id: string;
  name: string;
  path: string;
};
