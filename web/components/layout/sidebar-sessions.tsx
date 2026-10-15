import { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import {
  ChevronRightIcon,
  GitPullRequestIcon,
  MessageSquareIcon,
  Trash2Icon,
} from 'lucide-react';
import { cn } from '@web/lib/utils';
import type { SessionListItem } from '@web/lib/types';
import {
  repositoryLabel,
  sessionLabel,
  sessionMeta,
  sessionStatusLabel,
  sessionStatusTone,
} from '@web/lib/session-format';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@web/components/ui/collapsible';
import { Button } from '@web/components/ui/button';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@web/components/ui/sidebar';

type SessionGroup = {
  key: string;
  title: string;
  items: SessionListItem[];
};

/** 侧栏会话列表：按真实状态分成进行中与最近两组，组可折叠。 */
export function SidebarSessionGroups({
  sessions,
  activeSessionId,
  loaded,
  loadError,
  onRetry,
  onDelete,
}: {
  sessions: SessionListItem[];
  activeSessionId?: string;
  loaded: boolean;
  loadError: string | null;
  onRetry: () => void;
  onDelete: (session: SessionListItem) => void;
}) {
  const groups = useMemo<SessionGroup[]>(() => {
    const running = sessions.filter((session) => session.status === 'running');
    const recent = sessions.filter((session) => session.status !== 'running');
    return [
      { key: 'running', title: '进行中', items: running },
      { key: 'recent', title: '最近', items: recent },
    ].filter((group) => group.items.length > 0);
  }, [sessions]);

  if (loadError) {
    return (
      <div className="mx-3 my-2 space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-3 text-center">
        <p className="text-xs font-medium text-destructive">会话列表加载失败</p>
        <p className="break-words text-xs text-muted-foreground">{loadError}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          重试
        </Button>
      </div>
    );
  }

  if (loaded && groups.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-xs leading-relaxed text-muted-foreground">
        暂无会话。
        <br />
        新建对话，或等待 Webhook 触发审查。
      </p>
    );
  }

  return (
    <>
      {groups.map((group) => (
        <Collapsible key={group.key} defaultOpen className="group/collapsible">
          <SidebarGroup className="py-1">
            <SidebarGroupLabel
              render={<CollapsibleTrigger />}
              className="cursor-pointer gap-1 px-2"
            >
              <ChevronRightIcon className="size-3.5 transition-transform group-data-[panel-open]/collapsible:rotate-90" />
              {group.title}
              <span className="ml-auto tabular-nums text-muted-foreground">{group.items.length}</span>
            </SidebarGroupLabel>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {group.items.map((session) => (
                    <SidebarMenuItem key={session.id} className="group/menu-item">
                      <SidebarMenuButton
                        render={<NavLink to={`/c/${session.id}`} />}
                        isActive={session.id === activeSessionId}
                        tooltip={sessionLabel(session)}
                        className="h-auto items-start py-2 pe-8"
                      >
                        {session.kind === 'review' ? (
                          <GitPullRequestIcon className="mt-0.5" />
                        ) : (
                          <MessageSquareIcon className="mt-0.5" />
                        )}
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="truncate font-medium">{sessionLabel(session)}</span>
                          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                            <span
                              title={sessionStatusLabel[session.status] ?? session.status}
                              className={cn(
                                'size-1.5 shrink-0 rounded-full',
                                sessionStatusTone[session.status] ?? 'bg-muted-foreground',
                                session.status === 'running' && 'animate-pulse',
                              )}
                            />
                            <span className="truncate">{repositoryLabel(session)}</span>
                            <span className="truncate">·</span>
                            <span className="truncate">{sessionMeta(session)}</span>
                          </span>
                        </span>
                      </SidebarMenuButton>
                      <SidebarMenuAction
                        showOnHover
                        title="删除会话"
                        onClick={(event) => {
                          event.preventDefault();
                          onDelete(session);
                        }}
                      >
                        <Trash2Icon />
                      </SidebarMenuAction>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>
      ))}
    </>
  );
}

/** 图标栏模式：只保留会话图标，靠 tooltip 识别标题。 */
export function SidebarSessionRail({
  sessions,
  activeSessionId,
}: {
  sessions: SessionListItem[];
  activeSessionId?: string;
}) {
  return (
    <SidebarMenu className="items-center gap-1 px-0">
      {sessions.slice(0, 12).map((session) => (
        <SidebarMenuItem key={session.id} className="flex justify-center">
          <SidebarMenuButton
            render={<NavLink to={`/c/${session.id}`} />}
            isActive={session.id === activeSessionId}
            tooltip={sessionLabel(session)}
            className="size-8 justify-center p-0!"
          >
            {session.kind === 'review' ? <GitPullRequestIcon /> : <MessageSquareIcon />}
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}
