import type { ReviewRun, RunStatus } from './types';

export const runStatusLabels: Record<RunStatus, string> = {
  queued: '等待执行', running: '正在审查', cancelling: '正在取消', completed: '审查完成',
  partial: '部分完成', skipped: '已跳过', failed: '执行失败', cancelled: '已取消', interrupted: '执行中断',
};
export const activeRunStatuses = new Set<RunStatus>(['queued', 'running', 'cancelling']);

export function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未记录';
}
export function runDate(run: ReviewRun) { return run.createdAt ?? run.startedAt ?? run.finishedAt; }
export function runTitle(run: ReviewRun) { return run.session?.title || run.repository?.name || `审查 ${run.id.slice(0, 8)}`; }
