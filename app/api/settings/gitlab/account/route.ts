import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createGitLabService } from '@/lib/services/gitlab'

// GET /api/settings/gitlab/account - 获取单个 GitLab 账号
export async function GET() {
  try {
    const account = await prisma.gitLabAccount.findFirst({
      include: {
        _count: {
          select: {
            repositories: true,
          },
        },
      },
    })

    if (!account) {
      return NextResponse.json(null)
    }

    return NextResponse.json(account)
  } catch (error) {
    console.error('Failed to fetch GitLab account:', error)
    return NextResponse.json(
      { error: 'Failed to fetch GitLab account' },
      { status: 500 }
    )
  }
}

// POST /api/settings/gitlab/account - 创建 GitLab 账号（首次配置）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, url, accessToken, webhookSecret } = body

    // 验证是否已存在账号
    const existingAccount = await prisma.gitLabAccount.count()
    if (existingAccount > 0) {
      return NextResponse.json(
        { error: 'GitLab account already exists. Only one account is allowed.' },
        { status: 400 }
      )
    }

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
        webhookSecret: webhookSecret || null,
      },
      include: {
        _count: {
          select: {
            repositories: true,
          },
        },
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

// PUT /api/settings/gitlab/account - 更新 GitLab 账号
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, name, url, accessToken, webhookSecret, isActive } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Account ID is required' },
        { status: 400 }
      )
    }

    const updateData: any = {}
    if (name !== undefined) updateData.name = name
    if (url !== undefined) updateData.url = url
    if (accessToken !== undefined) updateData.accessToken = accessToken
    if (webhookSecret !== undefined) updateData.webhookSecret = webhookSecret
    if (isActive !== undefined) updateData.isActive = isActive

    const account = await prisma.gitLabAccount.update({
      where: { id },
      data: updateData,
      include: {
        _count: {
          select: {
            repositories: true,
          },
        },
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

// DELETE /api/settings/gitlab/account - 删除 GitLab 账号
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
