/**
 * @file /api/settings/gitlab
 * @description GitLab 账号配置管理 API
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createGitLabService } from '@/lib/services/gitlab'

/** GET /api/settings/gitlab - 获取所有 GitLab 账号 */
export async function GET() {
  try {
    const accounts = await prisma.gitLabAccount.findMany({
      include: {
        _count: {
          select: {
            repositories: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    return NextResponse.json(accounts)
  } catch (error) {
    console.error('Failed to fetch GitLab accounts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch GitLab accounts' },
      { status: 500 }
    )
  }
}

/** POST /api/settings/gitlab - 添加 GitLab 账号 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, url, accessToken, webhookSecret } = body

    // 测试连接
    const gitlabService = createGitLabService(url, accessToken)
    const isConnected = await gitlabService.testConnection()

    if (!isConnected) {
      return NextResponse.json(
        { error: 'Failed to connect to GitLab. Please check your URL and access token.' },
        { status: 400 }
      )
    }

    // 创建账号
    const account = await prisma.gitLabAccount.create({
      data: {
        url,
        accessToken,
        webhookSecret,
      },
    })

    return NextResponse.json(account)
  } catch (error) {
    console.error('Failed to create GitLab account:', error)
    return NextResponse.json(
      { error: 'Failed to create GitLab account' },
      { status: 500 }
    )
  }
}

/** PUT /api/settings/gitlab - 更新 GitLab 账号 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, name, url, accessToken, webhookSecret, isActive } = body

    const account = await prisma.gitLabAccount.update({
      where: { id },
      data: {
        url: url !== undefined ? url : undefined,
        accessToken: accessToken !== undefined ? accessToken : undefined,
        webhookSecret: webhookSecret !== undefined ? webhookSecret : undefined,
        isActive: isActive !== undefined ? isActive : undefined,
      },
    })

    return NextResponse.json(account)
  } catch (error) {
    console.error('Failed to update GitLab account:', error)
    return NextResponse.json(
      { error: 'Failed to update GitLab account' },
      { status: 500 }
    )
  }
}

/** DELETE /api/settings/gitlab - 删除 GitLab 账号 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'Account ID is required' },
        { status: 400 }
      )
    }

    await prisma.gitLabAccount.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete GitLab account:', error)
    return NextResponse.json(
      { error: 'Failed to delete GitLab account' },
      { status: 500 }
    )
  }
}
