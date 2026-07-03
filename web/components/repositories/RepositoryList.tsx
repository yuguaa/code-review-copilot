import { cn } from '../../lib/cn';
import type { Repo } from '../../hooks/useRepositoriesPageData';
import { Button } from '../ui/button';
import { Card } from '../ui/surface';

function modelLabel(repo: Repo): string {
  if (repo.customProvider && repo.customModelId) return `${repo.customProvider}/${repo.customModelId}`;
  if (repo.defaultAIModel) return `${repo.defaultAIModel.provider}/${repo.defaultAIModel.modelId}`;
  return '全局默认';
}

export function RepositoryList({
  repos,
  onEdit,
  onRemove,
}: {
  repos: Repo[];
  onEdit: (repo: Repo) => void;
  onRemove: (repo: Repo) => void;
}) {
  if (repos.length === 0) return <p className="text-center text-xs text-[var(--muted)]">还没有配置仓库</p>;

  return (
    <div className="space-y-3">
      {repos.map((repo) => (
        <Card key={repo.id} className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-[var(--ink)]">{repo.path}</p>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-medium',
                  repo.autoReview ? 'bg-[var(--success)]/12 text-[var(--success)]' : 'bg-[var(--surface-strong)] text-[var(--muted)]',
                )}
              >
                {repo.autoReview ? '自动审查' : '手动'}
              </span>
              {repo.enableMrComment && <span className="rounded-full bg-[var(--brand-lilac)]/45 px-2 py-0.5 text-[11px] text-[var(--body-strong)]">平台评论</span>}
              {repo.enableDingtalk && <span className="rounded-full bg-[var(--brand-cream)] px-2 py-0.5 text-[11px] text-[var(--body-strong)]">钉钉</span>}
            </div>
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              模型 {modelLabel(repo)} · 监听 {repo.watchBranches || '全部'} · Skills {repo.enabledSkills.length} · Tools {repo.enabledTools.length}
            </p>
          </div>
          <Button variant="secondary" onClick={() => onEdit(repo)}>
            编辑
          </Button>
          <Button variant="danger" onClick={() => onRemove(repo)}>
            删除
          </Button>
        </Card>
      ))}
    </div>
  );
}
