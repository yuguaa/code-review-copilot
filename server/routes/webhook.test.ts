import { describe, expect, it } from 'vitest';
import { buildPushSessionTitle } from '../modules/webhook/webhook.service';

describe('buildPushSessionTitle', () => {
  it('uses the latest commit message as the push session title', () => {
    expect(
      buildPushSessionTitle('main', {
        object_kind: 'push',
        project: { id: 1 },
        ref: 'refs/heads/main',
        before: 'a'.repeat(40),
        after: 'b'.repeat(40),
        total_commits_count: 1,
        commits: [
          {
            id: 'b'.repeat(40),
            message: 'feat: add repository title from commit message\n\nbody',
          },
        ],
      }),
    ).toBe('feat: add repository title from commit message');
  });

  it('shows the latest commit title and commit count for multiple commits', () => {
    expect(
      buildPushSessionTitle('main', {
        object_kind: 'push',
        project: { id: 1 },
        ref: 'refs/heads/main',
        before: 'a'.repeat(40),
        after: 'c'.repeat(40),
        checkout_sha: 'c'.repeat(40),
        total_commits_count: 2,
        commits: [
          { id: 'b'.repeat(40), title: 'fix: prepare repository config' },
          { id: 'c'.repeat(40), message: 'feat: polish sidebar titles' },
        ],
      }),
    ).toBe('feat: polish sidebar titles 等 2 个提交');
  });

  it('falls back to the push branch title when commit messages are absent', () => {
    expect(
      buildPushSessionTitle('develop', {
        object_kind: 'push',
        project: { id: 1 },
        ref: 'refs/heads/develop',
        before: 'a'.repeat(40),
        after: 'b'.repeat(40),
        total_commits_count: 0,
      }),
    ).toBe('Push develop (0 commits)');
  });
});
