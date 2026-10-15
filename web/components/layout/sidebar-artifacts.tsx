import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FolderGitIcon } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@web/lib/api';
import type { SessionListItem } from '@web/lib/types';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@web/components/ui/sidebar';

type RepositoryArtifact = {
  id: string;
  name: string;
  path: string;
};

/** 产物面板：被审查的仓库，以及每个仓库的会话数量。 */
export function SidebarRepositories({ sessions }: { sessions: SessionListItem[] }) {
  const [repositories, setRepositories] = useState<RepositoryArtifact[] | null>(null);

  useEffect(() => {
    api<{ repositories: RepositoryArtifact[] }>('/api/repositories')
      .then((data) => setRepositories(data.repositories))
      .catch((error) => {
        setRepositories([]);
        toast.error(error instanceof Error ? error.message : '仓库列表加载失败');
      });
  }, []);

  if (repositories === null) {
    return <p className="px-4 py-8 text-center text-xs text-muted-foreground">加载仓库中…</p>;
  }

  if (repositories.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-xs leading-relaxed text-muted-foreground">
        还没有仓库。
        <br />
        先接入 GitLab 项目，Webhook 触发的审查会归到对应仓库。
      </p>
    );
  }

  const countByRepository = sessions.reduce<Record<string, number>>((accumulator, session) => {
    const key = session.repository?.path;
    if (key) accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {});

  return (
    <SidebarGroup className="py-1">
      <SidebarGroupLabel className="px-2">仓库</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5">
          {repositories.map((repository) => (
            <SidebarMenuItem key={repository.id} className="group/menu-item">
              <SidebarMenuButton render={<Link to="/repositories" />} tooltip={repository.path}>
                <FolderGitIcon />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{repository.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{repository.path}</span>
                </span>
              </SidebarMenuButton>
              {countByRepository[repository.path] ? (
                <SidebarMenuBadge>{countByRepository[repository.path]}</SidebarMenuBadge>
              ) : null}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
