import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createGitLabService } from '@/lib/services/gitlab'

// GET /api/settings/gitlab/projects - 从 GitLab 获取项目列表（支持搜索）
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || undefined

    // 获取配置的 GitLab 账号
    const account = await prisma.gitLabAccount.findFirst({
      where: { isActive: true },
    })

    if (!account) {
      return NextResponse.json(
        { error: 'No active GitLab account found' },
        { status: 400 }
      )
    }

    const gitlabService = createGitLabService(account.url, account.accessToken)
    const projects = await gitlabService.getProjects(search)

    return NextResponse.json(projects)
  } catch (error) {
    console.error('Failed to fetch GitLab projects:', error)
    return NextResponse.json(
      { error: 'Failed to fetch GitLab projects' },
      { status: 500 }
    )
  }
}

// POST /api/settings/gitlab/projects - 从 GitLab 获取项目列表（支持搜索）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { search } = body

    // 获取配置的 GitLab 账号
    const account = await prisma.gitLabAccount.findFirst({
      where: { isActive: true },
    })

    if (!account) {
      return NextResponse.json(
        { error: 'No active GitLab account found' },
        { status: 400 }
      )
    }

    const gitlabService = createGitLabService(account.url, account.accessToken)
    const projects = await gitlabService.getProjects(search)

    return NextResponse.json(projects)
  } catch (error) {
    console.error('Failed to fetch GitLab projects:', error)
    return NextResponse.json(
      { error: 'Failed to fetch GitLab projects' },
      { status: 500 }
    )
  }
}
