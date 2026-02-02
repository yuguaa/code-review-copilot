'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  GitFork,
  Settings,
  HelpCircle,
  Bot,
  Clock,
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

  return (
    <div className="flex min-h-screen w-full">
      <aside className="hidden w-64 flex-col border-r md:flex">
        <div className="flex h-16 items-center border-b px-6">
          <Bot className="h-6 w-6 mr-2" />
          <span className="text-lg font-semibold">Code Review Copilot</span>
        </div>
        <nav className="flex-1 space-y-1 p-4">
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
              >
                <Icon className="h-4 w-4" />
                {item.title}
              </Link>
            )
          })}
        </nav>
      </aside>

      <main className="flex-1">
        {children}
      </main>
    </div>
  )
}
