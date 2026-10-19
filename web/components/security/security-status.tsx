import { Badge } from '@web/components/ui/badge';
import { cn } from '@web/lib/utils';

import type { SecuritySeverity, SecurityTicketStatus } from '@web/lib/types';

export const securityStatusLabels: Record<SecurityTicketStatus, string> = {
  queued: '排队中',
  running: '执行中',
  cancelling: '正在取消',
  completed: '已完成',
  failed: '执行失败',
  cancelled: '已取消',
  interrupted: '已中断',
};

export const securitySeverityLabels: Record<SecuritySeverity, string> = {
  critical: '严重',
  high: '高危',
  medium: '中危',
  low: '低危',
  info: '信息',
};

export function securityStatusDotClass(status: SecurityTicketStatus) {
  if (status === 'running' || status === 'queued') return 'animate-pulse bg-info';
  if (status === 'completed') return 'bg-success';
  if (status === 'failed' || status === 'interrupted') return 'bg-destructive';
  return 'bg-muted-foreground/50';
}

function securityStatusVariant(status: SecurityTicketStatus) {
  if (status === 'completed') return 'success-light' as const;
  if (status === 'failed' || status === 'interrupted') return 'destructive-light' as const;
  if (status === 'running' || status === 'queued') return 'info-light' as const;
  if (status === 'cancelling') return 'warning-light' as const;
  return 'secondary' as const;
}

function securitySeverityVariant(severity: SecuritySeverity) {
  if (severity === 'critical' || severity === 'high') return 'destructive-light' as const;
  if (severity === 'medium') return 'warning-light' as const;
  if (severity === 'low') return 'info-light' as const;
  return 'secondary' as const;
}

export function SecurityStatusBadge({ status }: { status: SecurityTicketStatus }) {
  return <Badge variant={securityStatusVariant(status)}>
    <span className={cn('size-1.5 rounded-full', securityStatusDotClass(status))} />
    {securityStatusLabels[status]}
  </Badge>;
}

export function SecuritySeverityBadge({ severity }: { severity: SecuritySeverity }) {
  return <Badge variant={securitySeverityVariant(severity)}>
    {securitySeverityLabels[severity]}
  </Badge>;
}

export function securityRiskTone(score: number | null) {
  if (score == null) return 'text-muted-foreground';
  if (score >= 80) return 'text-destructive';
  if (score >= 50) return 'text-orange-600';
  if (score > 0) return 'text-amber-700';
  return 'text-success';
}

export function formatSecurityDate(value: string | null | undefined) {
  if (!value) return '尚未记录';
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatSecurityBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

export function isSecurityRunning(status: SecurityTicketStatus) {
  return status === 'queued' || status === 'running' || status === 'cancelling';
}
