import { prisma } from '../../lib/prisma';

type SessionRow = {
  id: string;
  kind: string;
  status: string;
  author: string | null;
  title: string | null;
  mrIid: number | null;
  mrTitle: string | null;
  sourceBranch: string | null;
  targetBranch: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  repository: { id: string; name: string; path: string } | null;
  _count: { messages: number };
};

type Bucket = {
  key: string;
  label: string;
  total: number;
  reviews: number;
  chats: number;
  completed: number;
  failed: number;
  running: number;
  messages: number;
  repositories: Set<string>;
  repositoryHits: Map<string, number>;
  latestAt: Date | null;
};

type DashboardCounts = {
  repositoryCount: number;
  activeRepositoryCount: number;
  modelCount: number;
  accountCount: number;
  toolCount: number;
  skillCount: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const LOOKBACK_DAYS = 14;
const SESSION_LIMIT = 500;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dayKey(date: Date): string {
  return startOfDay(date).toISOString().slice(0, 10);
}

function dayLabel(key: string): string {
  const date = new Date(`${key}T00:00:00`);
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

function percent(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}

function emptyBucket(key: string, label: string): Bucket {
  return {
    key,
    label,
    total: 0,
    reviews: 0,
    chats: 0,
    completed: 0,
    failed: 0,
    running: 0,
    messages: 0,
    repositories: new Set(),
    repositoryHits: new Map(),
    latestAt: null,
  };
}

function addSession(bucket: Bucket, session: SessionRow): void {
  bucket.total += 1;
  bucket.reviews += session.kind === 'review' ? 1 : 0;
  bucket.chats += session.kind === 'chat' ? 1 : 0;
  bucket.completed += session.status === 'completed' ? 1 : 0;
  bucket.failed += session.status === 'failed' ? 1 : 0;
  bucket.running += session.status === 'running' ? 1 : 0;
  bucket.messages += session._count.messages;
  if (session.repository) {
    const repositoryKey = session.repository.path || session.repository.name || session.repository.id;
    bucket.repositories.add(session.repository.id);
    bucket.repositoryHits.set(repositoryKey, (bucket.repositoryHits.get(repositoryKey) ?? 0) + 1);
  }
  if (!bucket.latestAt || session.updatedAt > bucket.latestAt) bucket.latestAt = session.updatedAt;
}

function topRepository(bucket: Bucket): { label: string; count: number } | null {
  const [top] = Array.from(bucket.repositoryHits.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return top ? { label: top[0], count: top[1] } : null;
}

function serializeBucket(bucket: Bucket, totalSessions = 0, totalFailures = 0) {
  return {
    key: bucket.key,
    label: bucket.label,
    total: bucket.total,
    reviews: bucket.reviews,
    chats: bucket.chats,
    completed: bucket.completed,
    failed: bucket.failed,
    running: bucket.running,
    messages: bucket.messages,
    repositoryCount: bucket.repositories.size,
    topRepository: topRepository(bucket),
    latestAt: bucket.latestAt,
    successRate: percent(bucket.completed, bucket.completed + bucket.failed),
    failureRate: percent(bucket.failed, bucket.total),
    activityShare: percent(bucket.total, totalSessions),
    failureShare: percent(bucket.failed, totalFailures),
    avgMessagesPerSession: bucket.total === 0 ? 0 : Math.round((bucket.messages / bucket.total) * 10) / 10,
  };
}

function titleOf(session: SessionRow): string {
  if (session.kind === 'review') {
    const prefix = session.mrIid ? `!${session.mrIid} ` : '';
    return `${prefix}${session.mrTitle || session.title || '代码审查'}`;
  }
  return session.title || '新对话';
}

export function buildDashboardPayload(sessions: SessionRow[], counts: DashboardCounts, now = new Date()) {
  const since = startOfDay(new Date(now.getTime() - (LOOKBACK_DAYS - 1) * DAY_MS));
  const timeline = new Map<string, Bucket>();
  for (let i = 0; i < LOOKBACK_DAYS; i += 1) {
    const date = new Date(since.getTime() + i * DAY_MS);
    const key = dayKey(date);
    timeline.set(key, emptyBucket(key, dayLabel(key)));
  }

  const byRepository = new Map<string, Bucket>();
  const byAuthor = new Map<string, Bucket>();
  const byStatus = new Map<string, number>();

  for (const session of sessions) {
    const day = timeline.get(dayKey(session.createdAt));
    if (day) addSession(day, session);

    const repoKey = session.repository?.id ?? '__none__';
    const repoBucket = byRepository.get(repoKey) ?? emptyBucket(repoKey, session.repository?.path ?? '未关联仓库');
    addSession(repoBucket, session);
    byRepository.set(repoKey, repoBucket);

    const authorKey = session.author?.trim() || '未知人员';
    const authorBucket = byAuthor.get(authorKey) ?? emptyBucket(authorKey, authorKey);
    addSession(authorBucket, session);
    byAuthor.set(authorKey, authorBucket);

    byStatus.set(session.status, (byStatus.get(session.status) ?? 0) + 1);
  }

  const total = sessions.length;
  const reviewTotal = sessions.filter((session) => session.kind === 'review').length;
  const chatTotal = sessions.filter((session) => session.kind === 'chat').length;
  const completed = sessions.filter((session) => session.status === 'completed').length;
  const failed = sessions.filter((session) => session.status === 'failed').length;
  const running = sessions.filter((session) => session.status === 'running').length;
  const messageTotal = sessions.reduce((sum, session) => sum + session._count.messages, 0);

  const authorBuckets = Array.from(byAuthor.values())
    .map((bucket) => serializeBucket(bucket, total, failed))
    .sort((a, b) => b.total - a.total || b.failed - a.failed)
    .slice(0, 12);

  return {
    generatedAt: now,
    window: { days: LOOKBACK_DAYS, since },
    summary: {
      total,
      reviewTotal,
      chatTotal,
      completed,
      failed,
      running,
      messageTotal,
      authorCount: byAuthor.size,
      repositoryCount: counts.repositoryCount,
      activeRepositoryCount: counts.activeRepositoryCount,
      modelCount: counts.modelCount,
      accountCount: counts.accountCount,
      toolCount: counts.toolCount,
      skillCount: counts.skillCount,
      successRate: percent(completed, completed + failed),
      failureRate: percent(failed, completed + failed),
      avgMessagesPerSession: total === 0 ? 0 : Math.round((messageTotal / total) * 10) / 10,
    },
    timeline: Array.from(timeline.values()).map((bucket) => serializeBucket(bucket, total, failed)),
    statusDistribution: ['completed', 'failed', 'running'].map((status) => ({
      status,
      count: byStatus.get(status) ?? 0,
      percent: percent(byStatus.get(status) ?? 0, total),
    })),
    repositories: Array.from(byRepository.values())
      .map((bucket) => serializeBucket(bucket, total, failed))
      .sort((a, b) => b.total - a.total || b.failed - a.failed)
      .slice(0, 10),
    authors: authorBuckets,
    peopleSignals: {
      mostActive: authorBuckets[0] ?? null,
      mostFailures: [...authorBuckets].sort((a, b) => b.failed - a.failed || b.total - a.total)[0] ?? null,
      widestCoverage: [...authorBuckets].sort((a, b) => b.repositoryCount - a.repositoryCount || b.total - a.total)[0] ?? null,
      highestMessageDensity: [...authorBuckets].sort((a, b) => b.avgMessagesPerSession - a.avgMessagesPerSession || b.total - a.total)[0] ?? null,
    },
    failures: sessions
      .filter((session) => session.status === 'failed')
      .slice(0, 8)
      .map((session) => ({
        id: session.id,
        title: titleOf(session),
        author: session.author || '未知人员',
        repository: session.repository?.path ?? '未关联仓库',
        error: session.error ?? '未记录错误',
        updatedAt: session.updatedAt,
      })),
    recent: sessions.slice(0, 12).map((session) => ({
      id: session.id,
      kind: session.kind,
      status: session.status,
      title: titleOf(session),
      author: session.author || '未知人员',
      repository: session.repository?.path ?? '未关联仓库',
      sourceBranch: session.sourceBranch,
      targetBranch: session.targetBranch,
      messages: session._count.messages,
      updatedAt: session.updatedAt,
    })),
  };
}

export async function loadDashboardPayload() {
  const since = startOfDay(new Date(Date.now() - (LOOKBACK_DAYS - 1) * DAY_MS));
  const [sessions, repositoryCount, activeRepositoryCount, modelCount, accountCount, toolCount, skillCount] =
    await prisma.$transaction([
      prisma.session.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { updatedAt: 'desc' },
        include: {
          repository: { select: { id: true, name: true, path: true } },
          _count: { select: { messages: true } },
        },
        take: SESSION_LIMIT,
      }),
      prisma.repository.count(),
      prisma.repository.count({ where: { isActive: true } }),
      prisma.aIModel.count({ where: { isActive: true } }),
      prisma.gitLabAccount.count({ where: { isActive: true } }),
      prisma.agentTool.count({ where: { isActive: true } }),
      prisma.agentSkill.count({ where: { isActive: true } }),
    ]);

  return buildDashboardPayload(sessions, {
    repositoryCount,
    activeRepositoryCount,
    modelCount,
    accountCount,
    toolCount,
    skillCount,
  });
}
