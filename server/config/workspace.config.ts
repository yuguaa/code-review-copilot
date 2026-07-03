import path from 'node:path';

export type WorkspaceConfig = {
  root: string;
  ttlMs: number;
};

export const workspaceConfig: WorkspaceConfig = {
  root: path.resolve(process.env.WORKSPACE_ROOT ?? './.workspaces'),
  ttlMs: Number(process.env.WORKSPACE_TTL_HOURS ?? 72) * 3600_000,
};
