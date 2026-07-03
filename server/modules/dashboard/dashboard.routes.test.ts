import { describe, expect, it } from 'vitest';
import { buildDashboardPayload } from './dashboard.service';

function session(overrides: Record<string, unknown>) {
  const now = new Date('2026-07-03T08:00:00.000Z');
  return {
    id: String(overrides.id ?? 's1'),
    kind: String(overrides.kind ?? 'review'),
    status: String(overrides.status ?? 'completed'),
    author: (overrides.author as string | null | undefined) ?? '张三',
    title: null,
    mrIid: null,
    mrTitle: null,
    sourceBranch: null,
    targetBranch: null,
    error: null,
    createdAt: (overrides.createdAt as Date | undefined) ?? now,
    updatedAt: (overrides.updatedAt as Date | undefined) ?? now,
    repository: (overrides.repository as { id: string; name: string; path: string } | null | undefined) ?? {
      id: 'repo-1',
      name: '平台',
      path: 'group/platform',
    },
    _count: { messages: Number(overrides.messages ?? 2) },
  };
}

describe('buildDashboardPayload', () => {
  it('按人员维度统计活跃、失败、覆盖仓库和消息密度', () => {
    const payload = buildDashboardPayload(
      [
        session({ id: 's1', author: '张三', status: 'completed', messages: 4 }),
        session({ id: 's2', author: '张三', status: 'failed', messages: 8, repository: { id: 'repo-2', name: '管理端', path: 'group/admin' } }),
        session({ id: 's3', author: '李四', status: 'failed', messages: 3 }),
      ],
      {
        repositoryCount: 2,
        activeRepositoryCount: 2,
        modelCount: 1,
        accountCount: 1,
        toolCount: 6,
        skillCount: 6,
      },
      new Date('2026-07-03T09:00:00.000Z'),
    );

    expect(payload.summary.authorCount).toBe(2);
    expect(payload.summary.failureRate).toBe(67);

    const zhangsan = payload.authors.find((item) => item.label === '张三');
    expect(zhangsan).toMatchObject({
      total: 2,
      failed: 1,
      repositoryCount: 2,
      activityShare: 67,
      failureShare: 50,
      avgMessagesPerSession: 6,
    });

    expect(payload.peopleSignals.mostActive?.label).toBe('张三');
    expect(payload.peopleSignals.widestCoverage?.label).toBe('张三');
  });
});
