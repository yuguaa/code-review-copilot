/** 审查状态由运行服务维护，其他入口统一使用此忙碌状态集合。 */
export const busySessionStatuses = ['queued', 'running', 'cancelling'] as const;

export function isSessionBusy(status: string): boolean {
  return busySessionStatuses.some((value) => value === status);
}
