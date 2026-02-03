'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
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
import { cn } from '@/lib/utils'

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

export function AppSidebar({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isMobileCollapsed, setIsMobileCollapsed] = useState(true)

  // 响应式：在较小屏幕上自动折叠
  useEffect(() => {
    const handleResize = () => {
      // 当宽度小于 1280px 时自动折叠
      if (window.innerWidth < 1280) {
        setIsMobileCollapsed(true)
      } else {
        setIsMobileCollapsed(false)
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // 移动端折叠状态优先级高于手动折叠
  const collapsed = isMobileCollapsed || isCollapsed

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <aside
        className={cn(
          'hidden flex-col border-r transition-all duration-300 shrink-0 md:flex',
          collapsed ? 'w-16' : 'w-64'
        )}
      >
        {/* Logo 区域 */}
        <div className="flex h-16 items-center border-b px-4">
          <Bot className="h-6 w-6 shrink-0" />
          {!collapsed && (
            <span className="ml-2 text-lg font-semibold whitespace-nowrap">
              Code Review Copilot
            </span>
          )}
        </div>

        {/* 导航菜单 */}
        <nav className="flex-1 space-y-1 px-2">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
                title={collapsed ? item.title : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span>{item.title}</span>}
              </Link>
            )
          })}
        </nav>

        {/* 折叠按钮 */}
        <div className="border-t p-2">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
            title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4 shrink-0" />
            ) : (
              <>
                <PanelLeftClose className="h-4 w-4 shrink-0" />
                <span>折叠</span>
              </>
            )}
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
