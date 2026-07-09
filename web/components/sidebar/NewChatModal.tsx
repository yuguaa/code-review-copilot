import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import FolderGit2 from 'lucide-react/dist/esm/icons/folder-git-2';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import type { RepositoryItem } from '../../lib/types';
import { Button } from '../ui/button';
import { Modal } from '../ui/modal';

/** 新建对话弹层：明确选择仓库，而不是默默用第一个。 */
export function NewChatModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [repos, setRepos] = useState<RepositoryItem[] | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    setRepos(null);
    api<{ repositories: RepositoryItem[] }>('/api/repositories')
      .then((d) => {
        setRepos(d.repositories);
        setSelected(d.repositories[0]?.id ?? '');
      })
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : '仓库列表加载失败');
        setRepos([]);
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
        onClose();
        navigate(`/c/${session.id}`);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : '创建失败'))
      .finally(() => setCreating(false));
  };

  return (
    <Modal open={open} title="新建对话" onClose={onClose} maxWidth="max-w-md">
      {repos == null ? (
        <p className="py-4 text-center text-sm text-[var(--muted)]">加载仓库中…</p>
      ) : repos.length === 0 ? (
        <div className="space-y-3 py-2 text-center">
          <p className="text-sm text-[var(--body-strong)]">还没有可用仓库</p>
          <p className="text-xs text-[var(--muted)]">对话需要挂在一个仓库下，Agent 才能读取它的代码与记忆。</p>
          <Link to="/repositories" onClick={onClose} className="inline-block text-sm font-semibold text-[var(--brand-magenta)] hover:underline">
            去仓库配置 →
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-[var(--muted)]">选择对话关联的仓库，Agent 将在该仓库的工作区内回答问题。</p>
          <div className="max-h-72 space-y-1.5 overflow-y-auto">
            {repos.map((r) => (
              <label
                key={r.id}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 rounded-[var(--r-md)] border px-3 py-2.5 text-sm transition-colors',
                  selected === r.id
                    ? 'border-[var(--accent)] bg-[var(--surface-soft)] text-[var(--ink)] shadow-[var(--shadow-sm)]'
                    : 'border-[var(--line-default)] bg-[var(--surface-card)] text-[var(--body)] hover:border-[var(--line-accent)] hover:bg-[var(--surface-hover)]',
                )}
              >
                <input
                  type="radio"
                  name="new-chat-repo"
                  checked={selected === r.id}
                  onChange={() => setSelected(r.id)}
                  className="accent-[var(--brand-magenta)]"
                />
                <FolderGit2 size={14} className="shrink-0 text-[var(--muted)]" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.name}</span>
                  <span className="block truncate text-xs text-[var(--muted)]">{r.path}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} type="button" disabled={creating}>
              取消
            </Button>
            <Button onClick={create} disabled={creating || !selected}>
              {creating ? '创建中…' : '开始对话'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
