import { useState } from 'react';
import { NavLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  BarChart3Icon,
  CircleHelpIcon,
  FolderGitIcon,
  LogOutIcon,
  MessageSquarePlusIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  RssIcon,
  ScanSearchIcon,
  SettingsIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@web/lib/api';
import { cn } from '@web/lib/utils';
import { useSidebarSessions } from '@web/hooks/useSidebarSessions';
import type { SessionListItem } from '@web/lib/types';
import { Avatar, AvatarFallback } from '@web/components/ui/avatar';
import { Button } from '@web/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@web/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from '@web/components/ui/sidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@web/components/ui/tabs';
import { useConfirm } from '@web/components/ui/confirm-dialog';
import { NewChatDialog } from './new-chat-dialog';
import { useShell } from './shell-context';
import { SidebarRepositories } from './sidebar-artifacts';
import { SidebarSessionGroups, SidebarSessionRail } from './sidebar-sessions';
import { sessionLabel } from '@web/lib/session-format';

const NAV_ITEMS = [
  { to: '/dashboard', label: '数据看板', icon: BarChart3Icon },
  { to: '/repositories', label: '仓库配置', icon: FolderGitIcon },
  { to: '/rss', label: 'RSS 订阅', icon: RssIcon },
  { to: '/settings', label: '设置', icon: SettingsIcon },
  { to: '/help', label: '帮助中心', icon: CircleHelpIcon },
];

export function AppSidebar() {
  const { collapsed } = useShell();
  const [tab, setTab] = useState('chats');
  const [newChatOpen, setNewChatOpen] = useState(false);
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { confirm, element: confirmElement } = useConfirm();
  const { sessions, loadError, loaded, load, deleteSession } = useSidebarSessions();

  const removeSession = (session: SessionListItem) => {
    void confirm({
      title: '删除会话',
      description: `「${sessionLabel(session)}」及其全部消息将被删除，无法恢复。`,
    }).then((approved) => {
      if (!approved) return;
      deleteSession(session.id)
        .then(() => {
          if (session.id === sessionId) navigate('/');
        })
        .catch((error) => toast.error(error instanceof Error ? error.message : '删除失败'));
    });
  };

  const logout = () => {
    api('/api/auth/logout', { method: 'POST' })
      .catch(() => undefined)
      .then(() => {
        window.location.href = '/login';
      });
  };

  return (
    <Sidebar
      collapsible="none"
      data-collapsible={collapsed ? 'icon' : ''}
      className={cn('group h-full w-full border-r border-sidebar-border', collapsed && 'overflow-hidden')}
    >
      <SidebarHeader className={cn('gap-2 p-2', collapsed && 'items-center p-2')}>
        <div className={cn('flex w-full items-center gap-2', collapsed && 'flex-col')}>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ScanSearchIcon className="size-4" />
          </span>
          <div className={cn('min-w-0 flex-1', collapsed && 'hidden')}>
            <span className="block truncate text-sm font-medium">代码审查工作台</span>
            <span className="block truncate text-xs text-muted-foreground">Review Console</span>
          </div>
          <HeaderCollapseButton />
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0">
        {collapsed ? (
          <>
            <SidebarMenu className="items-center gap-1 px-0 pt-1">
              <SidebarMenuItem className="flex justify-center">
                <SidebarMenuButton
                  tooltip="新建对话"
                  className="size-8 justify-center p-0!"
                  onClick={() => setNewChatOpen(true)}
                >
                  <MessageSquarePlusIcon />
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <SidebarSeparator className="mx-2 my-2 w-auto" />
            <SidebarSessionRail sessions={sessions} activeSessionId={sessionId} />
          </>
        ) : (
          <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
            <div className="px-2 py-1">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="chats">会话</TabsTrigger>
                <TabsTrigger value="artifacts">仓库</TabsTrigger>
              </TabsList>
            </div>
            <div className="px-2 pb-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2"
                onClick={() => setNewChatOpen(true)}
              >
                <MessageSquarePlusIcon className="size-4" />
                新建对话
              </Button>
            </div>
            <TabsContent value="chats" className="min-h-0 flex-1 overflow-y-auto">
              <SidebarSessionGroups
                sessions={sessions}
                activeSessionId={sessionId}
                loaded={loaded}
                loadError={loadError}
                onRetry={() => void load()}
                onDelete={removeSession}
              />
            </TabsContent>
            <TabsContent value="artifacts" className="min-h-0 flex-1 overflow-y-auto">
              <SidebarRepositories sessions={sessions} />
            </TabsContent>
          </Tabs>
        )}
      </SidebarContent>

      <SidebarFooter className={cn('gap-1 p-2', collapsed && 'items-center')}>
        <SidebarMenu className={cn('gap-0.5', collapsed && 'items-center')}>
          {NAV_ITEMS.map((item) => (
            <SidebarMenuItem key={item.to} className={cn(collapsed && 'flex justify-center')}>
              <SidebarMenuButton
                render={<NavLink to={item.to} />}
                isActive={location.pathname === item.to}
                tooltip={item.label}
                className={cn(collapsed && 'size-8 justify-center p-0!')}
              >
                <item.icon />
                <span className={cn(collapsed && 'hidden')}>{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
        <SidebarSeparator className={cn('mx-0 w-auto', collapsed && 'hidden')} />
        <AccountMenu collapsed={collapsed} onLogout={logout} />
      </SidebarFooter>

      <NewChatDialog open={newChatOpen} onOpenChange={setNewChatOpen} />
      {confirmElement}
    </Sidebar>
  );
}

function HeaderCollapseButton() {
  const { collapsed, toggleSidebar } = useShell();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={collapsed ? '展开侧栏' : '折叠侧栏'}
      onClick={toggleSidebar}
    >
      {collapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
      <span className="sr-only">{collapsed ? '展开侧栏' : '折叠侧栏'}</span>
    </Button>
  );
}

function AccountMenu({ collapsed, onLogout }: { collapsed: boolean; onLogout: () => void }) {
  return (
    <SidebarMenu className={cn(collapsed && 'items-center')}>
      <SidebarMenuItem className={cn(collapsed && 'flex justify-center')}>
        <DropdownMenu>
          <SidebarMenuButton
            render={<DropdownMenuTrigger />}
            title="账号"
            className={cn(collapsed && 'size-8 justify-center p-0!')}
          >
            <Avatar className="size-6 rounded-md">
              <AvatarFallback className="rounded-md text-xs">管</AvatarFallback>
            </Avatar>
            <span className={cn('min-w-0 flex-1 truncate', collapsed && 'hidden')}>已登录</span>
          </SidebarMenuButton>
          <DropdownMenuContent side="top" align="start" className="w-40">
            <DropdownMenuItem onClick={onLogout}>
              <LogOutIcon />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
