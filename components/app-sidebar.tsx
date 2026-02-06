'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  GitFork,
  Settings,
  HelpCircle,
  Bot,
  Clock,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarInset,
  useSidebar,
} from '@/components/ui/sidebar'

const navItems = [
  {
    title: '仪表盘',
    href: '/',
    icon: LayoutDashboard,
  },
  {
    title: '仓库管理',
    href: '/repositories',
    icon: GitFork,
  },
  {
    title: '审查历史',
    href: '/reviews',
    icon: Clock,
  },
  {
    title: '配置',
    href: '/settings',
    icon: Settings,
  },
  {
    title: '帮助中心',
    href: '/help',
    icon: HelpCircle,
  },
]

function SidebarToggle() {
  const { toggleSidebar, open } = useSidebar()

  return (
    <SidebarMenuButton onClick={toggleSidebar} tooltip={open ? '折叠' : '展开'}>
      {open ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
      <span>折叠</span>
    </SidebarMenuButton>
  )
}

export function AppSidebar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link href="/">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <Bot className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">Code Review</span>
                    <span className="truncate text-xs">Copilot</span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === item.href}
                      tooltip={item.title}
                    >
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarToggle />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
