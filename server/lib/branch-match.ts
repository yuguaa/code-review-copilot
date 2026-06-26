/**
 * watchBranches 匹配：逗号分隔的模式，支持 `*` 通配。
 * 空配置 = 匹配所有分支。
 */
export function matchesWatchBranches(patterns: string | null | undefined, branch: string): boolean {
  const list = (patterns ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) return true;
  return list.some((p) => globToRegExp(p).test(branch));
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}
