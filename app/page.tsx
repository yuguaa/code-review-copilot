import { Suspense } from 'react'
import { prisma } from '@/lib/prisma'
import {
  Card,
  CardContent,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  GitFork,
  FileCode,
  AlertCircle,
  AlertTriangle,
  Lightbulb,
  TrendingUp
} from 'lucide-react'

async function getDashboardStats() {
  const [
    totalRepositories,
    activeRepositories,
    totalReviews,
    reviewsThisWeek,
    issueStats,
    topRepositories,
    topUsers,
  ] = await Promise.all([
    prisma.repository.count(),
    prisma.repository.count({ where: { isActive: true } }),
    prisma.reviewLog.count(),
    prisma.reviewLog.count({
      where: {
        startedAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      },
    }),
    prisma.reviewLog.aggregate({
      _sum: {
        criticalIssues: true,
        normalIssues: true,
        suggestions: true,
      },
    }),
    prisma.reviewLog.groupBy({
      by: ['repositoryId'],
      _count: {
        id: true,
      },
      _sum: {
        criticalIssues: true,
        normalIssues: true,
        suggestions: true,
      },
      orderBy: {
        _count: {
          id: 'desc',
        },
      },
      take: 5,
    }),
    prisma.reviewLog.groupBy({
      by: ['author'],
      _count: {
        id: true,
      },
      _sum: {
        criticalIssues: true,
        normalIssues: true,
        suggestions: true,
      },
      orderBy: {
        _count: {
          id: 'desc',
        },
      },
      take: 5,
    }),
  ])

  // 获取仓库名称
  const repositoryIds = topRepositories.map((r: any) => r.repositoryId)
  const repositories = await prisma.repository.findMany({
    where: {
      id: { in: repositoryIds },
    },
    select: {
      id: true,
      name: true,
    },
  })

  const repoMap = new Map(repositories.map((r: any) => [r.id, r.name]))

  const topReposWithNames = topRepositories.map((r: any) => ({
    repositoryId: r.repositoryId,
    repositoryName: repoMap.get(r.repositoryId) || 'Unknown',
    reviewCount: r._count.id,
    issueCount: (r._sum.criticalIssues || 0) + (r._sum.normalIssues || 0) + (r._sum.suggestions || 0),
  }))

  return {
    totalRepositories,
    activeRepositories,
    totalReviews,
    reviewsThisWeek,
    totalIssues: {
      critical: issueStats._sum.criticalIssues || 0,
      normal: issueStats._sum.normalIssues || 0,
      suggestion: issueStats._sum.suggestions || 0,
    },
    topRepositories: topReposWithNames,
    topUsers: topUsers.map((u: any) => ({
      username: u.author,
      reviewCount: u._count.id,
      issueCount: (u._sum.criticalIssues || 0) + (u._sum.normalIssues || 0) + (u._sum.suggestions || 0),
    })),
  }
}

function StatCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
}: {
  title: string
  value: string | number
  description?: string | React.ReactNode
  icon: any
  trend?: string
}) {
  return (
    <Card className="border-border/40">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-sm font-medium text-muted-foreground mb-1">{title}</p>
            <p className="text-2xl font-bold text-foreground">{value}</p>
            {description && typeof description === 'string' && (
              <p className="text-xs text-muted-foreground mt-1">{description}</p>
            )}
            {description && typeof description !== 'string' && (
              <div className="mt-2">{description}</div>
            )}
            {trend && (
              <p className="text-xs text-green-600 flex items-center mt-1">
                <TrendingUp className="h-3 w-3 mr-1" />
                {trend}
              </p>
            )}
          </div>
          <div className="ml-4 flex h-10 w-10 items-center justify-center rounded-lg bg-sidebar">
            <Icon className="h-5 w-5 text-sidebar-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-8 w-16 mb-2" />
              <Skeleton className="h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-6 w-32 mb-4" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-6 w-32 mb-4" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

async function DashboardContent() {
  const stats = await getDashboardStats()

  return (
    <div className="space-y-6">
      {/* 统计卡片 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="仓库总数"
          value={stats.totalRepositories}
          description={`${stats.activeRepositories} 个活跃`}
          icon={GitFork}
        />
        <StatCard
          title="审查总数"
          value={stats.totalReviews}
          description={`本周 ${stats.reviewsThisWeek} 次`}
          icon={FileCode}
          trend="+12%"
        />
        <StatCard
          title="发现问题"
          value={
            stats.totalIssues.critical +
            stats.totalIssues.normal +
            stats.totalIssues.suggestion
          }
          description={
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className="bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive/20">
                {stats.totalIssues.critical} 严重
              </Badge>
              <Badge className="bg-sidebar hover:bg-sidebar-accent text-sidebar-foreground border-border/40">
                {stats.totalIssues.normal} 一般
              </Badge>
              <Badge className="bg-sidebar hover:bg-sidebar-accent text-sidebar-foreground border-border/40">
                {stats.totalIssues.suggestion} 建议
              </Badge>
            </div>
          }
          icon={AlertCircle}
        />
        <StatCard
          title="本周审查"
          value={stats.reviewsThisWeek}
          description="过去 7 天"
          icon={TrendingUp}
        />
      </div>

      {/* 详细统计 */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* 仓库维度统计 */}
        <Card className="border-border/40">
          <div className="p-6">
            <h3 className="text-base font-semibold text-foreground mb-1">仓库审查排行</h3>
            <p className="text-sm text-muted-foreground mb-4">按审查数量排序的 Top 5 仓库</p>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-b-2">
                  <TableHead className="h-10 px-4 text-xs font-semibold text-muted-foreground">仓库名称</TableHead>
                  <TableHead className="h-10 px-4 text-xs font-semibold text-muted-foreground text-right">审查数</TableHead>
                  <TableHead className="h-10 px-4 text-xs font-semibold text-muted-foreground text-right">问题数</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.topRepositories.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                      暂无数据
                    </TableCell>
                  </TableRow>
                ) : (
                  stats.topRepositories.map((repo: any) => (
                    <TableRow key={repo.repositoryId} className="hover:bg-sidebar/50">
                      <TableCell className="px-4 py-3 font-medium text-foreground">{repo.repositoryName}</TableCell>
                      <TableCell className="px-4 py-3 text-right text-muted-foreground">{repo.reviewCount}</TableCell>
                      <TableCell className="px-4 py-3 text-right text-muted-foreground">{repo.issueCount}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>

        {/* 用户维度统计 */}
        <Card className="border-border/40">
          <div className="p-6">
            <h3 className="text-base font-semibold text-foreground mb-1">用户审查排行</h3>
            <p className="text-sm text-muted-foreground mb-4">按被审查次数排序的 Top 5 用户</p>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-b-2">
                  <TableHead className="h-10 px-4 text-xs font-semibold text-muted-foreground">用户名</TableHead>
                  <TableHead className="h-10 px-4 text-xs font-semibold text-muted-foreground text-right">被审查数</TableHead>
                  <TableHead className="h-10 px-4 text-xs font-semibold text-muted-foreground text-right">发现问题</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.topUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                      暂无数据
                    </TableCell>
                  </TableRow>
                ) : (
                  stats.topUsers.map((user: any, index: number) => (
                    <TableRow key={index} className="hover:bg-sidebar/50">
                      <TableCell className="px-4 py-3 font-medium text-foreground">{user.username}</TableCell>
                      <TableCell className="px-4 py-3 text-right text-muted-foreground">{user.reviewCount}</TableCell>
                      <TableCell className="px-4 py-3 text-right text-muted-foreground">{user.issueCount}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>

      {/* 问题分布 */}
      <Card className="border-border/40">
        <div className="p-6">
          <h3 className="text-base font-semibold text-foreground mb-1">问题级别分布</h3>
          <p className="text-sm text-muted-foreground mb-4">所有审查中的问题严重级别统计</p>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-4 rounded-lg border border-border/40">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/10">
                  <AlertCircle className="h-4 w-4 text-destructive" />
                </div>
                <span className="font-medium text-foreground">严重问题</span>
              </div>
              <Badge className="bg-destructive text-white border-0 hover:bg-destructive/90">
                {stats.totalIssues.critical}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-4 rounded-lg border border-border/40">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar">
                  <AlertTriangle className="h-4 w-4 text-foreground" />
                </div>
                <span className="font-medium text-foreground">一般问题</span>
              </div>
              <Badge className="bg-sidebar text-foreground border-border/40 hover:bg-sidebar-accent">
                {stats.totalIssues.normal}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-4 rounded-lg border border-border/40">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar">
                  <Lightbulb className="h-4 w-4 text-foreground" />
                </div>
                <span className="font-medium text-foreground">建议</span>
              </div>
              <Badge className="bg-sidebar text-foreground border-border/40 hover:bg-sidebar-accent">
                {stats.totalIssues.suggestion}
              </Badge>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

export default function HomePage() {
  return (
    <div className="p-8">
      {/* 页面标题 */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground mb-1">
          仪表盘
        </h1>
        <p className="text-sm text-muted-foreground">
          GitLab 代码审查统计概览
        </p>
      </div>

      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </div>
  )
}
