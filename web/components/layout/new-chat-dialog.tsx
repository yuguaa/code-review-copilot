import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FolderGitIcon } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@web/lib/api';
import { cn } from '@web/lib/utils';
import type { RepositoryItem } from '@web/lib/types';
import { Button } from '@web/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@web/components/ui/dialog';
import { ScrollArea } from '@web/components/ui/scroll-area';

/** 新建对话：必须先选定仓库，Agent 才有可读的工作区与记忆。 */
export function NewChatDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [repos, setRepos] = useState<RepositoryItem[] | null>(null);
  const [selected, setSelected] = useState('');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    setRepos(null);
    api<{ repositories: RepositoryItem[] }>('/api/repositories')
      .then((data) => {
        setRepos(data.repositories);
        setSelected(data.repositories[0]?.id ?? '');
      })
      .catch((error) => {
        setRepos([]);
        toast.error(error instanceof Error ? error.message : '仓库列表加载失败');
      });
  }, [open]);

  const create = () => {
    if (!selected) return;
    setCreating(true);
    api<{ session: { id: string } }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ repositoryId: selected }),
    })
      .then(({ session }) => {
        onOpenChange(false);
        navigate(`/c/${session.id}`);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : '创建失败'))
      .finally(() => setCreating(false));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建对话</DialogTitle>
          <DialogDescription>选择对话关联的仓库，Agent 将在该仓库的工作区内回答问题。</DialogDescription>
        </DialogHeader>

        {repos === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">加载仓库中…</p>
        ) : repos.length === 0 ? (
          <div className="space-y-2 py-2 text-center">
            <p className="text-sm">还没有可用仓库</p>
            <p className="text-sm text-muted-foreground">对话需要挂在一个仓库下，Agent 才能读取它的代码与记忆。</p>
            <Link
              className="text-sm font-medium underline underline-offset-4"
              onClick={() => onOpenChange(false)}
              to="/repositories"
            >
              去仓库配置
            </Link>
          </div>
        ) : (
          <>
            <ScrollArea className="max-h-72">
              <div className="space-y-1 pr-3">
                {repos.map((repo) => (
                  <button
                    key={repo.id}
                    type="button"
                    onClick={() => setSelected(repo.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                      selected === repo.id
                        ? 'border-primary bg-accent'
                        : 'border-transparent hover:bg-accent',
                    )}
                  >
                    <FolderGitIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{repo.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{repo.path}</span>
                    </span>
                  </button>
                ))}
              </div>
            </ScrollArea>
            <div className="flex justify-end gap-2">
              <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={creating}>
                取消
              </Button>
              <Button type="button" onClick={create} disabled={creating || !selected}>
                {creating ? '创建中…' : '开始对话'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
