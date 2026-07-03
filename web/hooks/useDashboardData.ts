import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../lib/api';

export type DashboardSummary = {
  total: number;
  reviewTotal: number;
  chatTotal: number;
  completed: number;
  failed: number;
  running: number;
  messageTotal: number;
  authorCount: number;
  repositoryCount: number;
  activeRepositoryCount: number;
  modelCount: number;
  accountCount: number;
  toolCount: number;
  skillCount: number;
  successRate: number;
  failureRate: number;
  avgMessagesPerSession: number;
};

export type DashboardBucket = {
  key: string;
  label: string;
  total: number;
  reviews: number;
  chats: number;
  completed: number;
  failed: number;
  running: number;
  messages: number;
  repositoryCount: number;
  topRepository: { label: string; count: number } | null;
  latestAt: string | null;
  successRate: number;
  failureRate: number;
  activityShare: number;
  failureShare: number;
  avgMessagesPerSession: number;
};

export type FailureItem = {
  id: string;
  title: string;
  author: string;
  repository: string;
  error: string;
  updatedAt: string;
};

export type RecentItem = {
  id: string;
  kind: string;
  status: string;
  title: string;
  author: string;
  repository: string;
  sourceBranch: string | null;
  targetBranch: string | null;
  messages: number;
  updatedAt: string;
};

export type PeopleSignals = {
  mostActive: DashboardBucket | null;
  mostFailures: DashboardBucket | null;
  widestCoverage: DashboardBucket | null;
  highestMessageDensity: DashboardBucket | null;
};

export type DashboardData = {
  generatedAt: string;
  window: { days: number; since: string };
  summary: DashboardSummary;
  timeline: DashboardBucket[];
  statusDistribution: { status: string; count: number; percent: number }[];
  repositories: DashboardBucket[];
  authors: DashboardBucket[];
  peopleSignals: PeopleSignals;
  failures: FailureItem[];
  recent: RecentItem[];
};

export type DashboardStatusChartItem = DashboardData['statusDistribution'][number] & {
  name: string;
  label: string;
};

export type DashboardChartBucket = DashboardBucket & {
  name: string;
};

export const dashboardStatusText: Record<string, string> = {
  completed: '完成',
  failed: '失败',
  running: '运行中',
};

function shortLabel(value: string, max = 18): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function useDashboardData() {
  const [data, setData] = useState<DashboardData | null>(null);

  const load = useCallback(() => {
    return api<DashboardData>('/api/dashboard')
      .then(setData)
      .catch((e) => toast.error(e instanceof Error ? e.message : '看板加载失败'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const statusChart = useMemo(
    () =>
      (data?.statusDistribution ?? []).map((item) => ({
        ...item,
        name: item.status,
        label: dashboardStatusText[item.status] ?? item.status,
      })),
    [data],
  );

  const authorChart = useMemo(
    () =>
      (data?.authors ?? []).map((item) => ({
        ...item,
        name: shortLabel(item.label, 12),
      })),
    [data],
  );

  const repositoryChart = useMemo(
    () =>
      (data?.repositories ?? []).map((item) => ({
        ...item,
        name: shortLabel(item.label, 20),
      })),
    [data],
  );

  return { data, statusChart, authorChart, repositoryChart };
}
