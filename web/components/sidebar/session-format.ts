import type { SessionListItem } from '../../lib/types';

export const statusColor: Record<string, string> = {
  running: 'bg-[var(--brand-cream)]',
  completed: 'bg-[var(--success)]',
  failed: 'bg-[var(--error)]',
};

export const statusLabel: Record<string, string> = {
  running: '审查进行中',
  completed: '已完成',
  failed: '失败',
};

/** 会话标题展示：审查会话带 MR 编号，普通对话空标题回退「新对话」。 */
export function sessionLabel(s: SessionListItem): string {
  if (s.kind === 'review') {
    const prefix = s.mrIid ? `!${s.mrIid} ` : '';
    return `${prefix}${s.title || '代码审查'}`;
  }
  return s.title || '新对话';
}

export function sessionMeta(s: SessionListItem): string {
  const branch =
    s.sourceBranch && s.targetBranch ? `${s.sourceBranch} → ${s.targetBranch}` : s.sourceBranch ?? s.targetBranch;
  const time = new Date(s.updatedAt).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return [branch, time].filter(Boolean).join(' · ');
}

export function repositoryLabel(s: SessionListItem): string {
  return s.repository?.name || s.repository?.path?.split('/').pop() || '未关联仓库';
}
