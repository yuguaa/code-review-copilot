import { describe, it, expect } from 'vitest';
import { matchesWatchBranches } from './branch-match';

describe('matchesWatchBranches', () => {
  it('空配置匹配所有分支', () => {
    expect(matchesWatchBranches(null, 'main')).toBe(true);
    expect(matchesWatchBranches('', 'any/branch')).toBe(true);
    expect(matchesWatchBranches('   ', 'x')).toBe(true);
  });

  it('精确匹配', () => {
    expect(matchesWatchBranches('main,develop', 'main')).toBe(true);
    expect(matchesWatchBranches('main,develop', 'develop')).toBe(true);
    expect(matchesWatchBranches('main,develop', 'feature/x')).toBe(false);
  });

  it('通配符匹配', () => {
    expect(matchesWatchBranches('feature/*', 'feature/login')).toBe(true);
    expect(matchesWatchBranches('feature/*', 'feature/a/b')).toBe(true);
    expect(matchesWatchBranches('feature/*', 'main')).toBe(false);
    expect(matchesWatchBranches('release-*', 'release-1.2')).toBe(true);
  });

  it('正则元字符按字面处理', () => {
    expect(matchesWatchBranches('v1.0', 'v1.0')).toBe(true);
    expect(matchesWatchBranches('v1.0', 'v1x0')).toBe(false);
  });
});
