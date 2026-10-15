import { cn } from '../../lib/utils';
import type { Repo } from '../../hooks/useRepositoriesPageData';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';

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
  if (repos.length === 0) {
    return <p className="text-center text-sm text-muted-foreground">还没有配置仓库</p>;
  }

  return (
    <div className="space-y-2">
      {repos.map((repo) => (
        <Card
          key={repo.id}
          className="flex-row items-center gap-4 px-5 py-4 max-md:flex-col max-md:items-stretch"
        >
          <span
            className={cn('h-12 w-px shrink-0 max-md:hidden', repo.autoReview ? 'bg-chart-2' : 'bg-border')}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-medium">{repo.path}</p>
              <Badge variant={repo.autoReview ? 'secondary' : 'outline'}>
                {repo.autoReview ? '自动审查' : '手动'}
              </Badge>
              {repo.enableMrComment ? <Badge variant="outline">平台评论</Badge> : null}
              {repo.enableDingtalk ? <Badge variant="outline">钉钉</Badge> : null}
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              模型 {modelLabel(repo)} · 监听 {repo.watchBranches || '全部'} · Skills {repo.enabledSkills.length} · Tools{' '}
              {repo.enabledTools.length}
            </p>
          </div>
          <div className="flex shrink-0 gap-2 border-l pl-4 max-md:border-l-0 max-md:border-t max-md:pt-3 max-md:pl-0">
            <Button variant="outline" onClick={() => onEdit(repo)}>
              编辑
            </Button>
            <Button variant="destructive" onClick={() => onRemove(repo)}>
              删除
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
