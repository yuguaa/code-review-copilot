import type { SessionListItem } from './types';

export const sessionStatusTone: Record<string, string> = {
  running: 'bg-warning',
  completed: 'bg-success',
  failed: 'bg-destructive',
};

export const sessionStatusLabel: Record<string, string> = {
  running: '审查进行中',
  completed: '已完成',
  failed: '失败',
};

/** 会话标题：审查会话带 MR 编号，普通对话空标题回退「新对话」。 */
export function sessionLabel(session: SessionListItem): string {
  if (session.kind === 'review') {
    const prefix = session.mrIid ? `!${session.mrIid} ` : '';
    return `${prefix}${session.title || '代码审查'}`;
  }
  return session.title || '新对话';
}

export function sessionMeta(session: SessionListItem): string {
  const branch =
    session.sourceBranch && session.targetBranch
      ? `${session.sourceBranch} → ${session.targetBranch}`
      : session.sourceBranch ?? session.targetBranch;
  const time = new Date(session.updatedAt).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return [branch, time].filter(Boolean).join(' · ');
}

export function repositoryLabel(session: SessionListItem): string {
  return session.repository?.name || session.repository?.path?.split('/').pop() || '未关联仓库';
}
