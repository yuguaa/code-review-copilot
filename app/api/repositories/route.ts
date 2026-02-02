import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createGitLabService } from '@/lib/services/gitlab'

// GET /api/repositories - 获取所有仓库
export async function GET() {
  try {
    const repositories = await prisma.repository.findMany({
      include: {
        gitLabAccount: {
          select: {
            id: true,
            url: true,
          },
        },
        defaultAIModel: {
          select: {
            id: true,
            provider: true,
            modelId: true,
            isActive: true,
          },
        },
        branchConfigs: {
          include: {
            aiModel: {
              select: {
                id: true,
                provider: true,
              },
            },
          },
        },
        _count: {
          select: {
            reviewLogs: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    return NextResponse.json(repositories)
  } catch (error) {
    console.error('Failed to fetch repositories:', error)
    return NextResponse.json(
      { error: 'Failed to fetch repositories' },
      { status: 500 }
    )
  }
}

// POST /api/repositories - 添加新仓库
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { gitLabAccountId, gitLabProjectId } = body

    // 验证 GitLab 账号
    const gitLabAccount = await prisma.gitLabAccount.findUnique({
      where: { id: gitLabAccountId },
    })

    if (!gitLabAccount) {
      return NextResponse.json(
        { error: 'GitLab account not found' },
        { status: 404 }
      )
    }

    // 从 GitLab 获取项目信息
    const gitlabService = createGitLabService(
      gitLabAccount.url,
      gitLabAccount.accessToken
    )

    const project = await gitlabService.getProject(gitLabProjectId)

    // 创建仓库配置
    const repository = await prisma.repository.create({
      data: {
        gitLabProjectId: project.id,
        name: project.name,
        path: project.path_with_namespace,
        description: project.description,
        gitLabAccountId,
      },
      include: {
        gitLabAccount: true,
      },
    })

    return NextResponse.json(repository)
  } catch (error) {
    console.error('Failed to create repository:', error)
    return NextResponse.json(
      { error: 'Failed to create repository' },
      { status: 500 }
    )
  }
}

// PUT /api/repositories - 更新仓库配置
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, isActive, autoReview, defaultAIModelId } = body

    const updateData: any = {}
    if (isActive !== undefined) updateData.isActive = isActive
    if (autoReview !== undefined) updateData.autoReview = autoReview
    if (defaultAIModelId !== undefined) updateData.defaultAIModelId = defaultAIModelId

    const repository = await prisma.repository.update({
      where: { id },
      data: updateData,
      include: {
        gitLabAccount: true,
        defaultAIModel: {
          select: {
            id: true,
            provider: true,
            modelId: true,
            isActive: true,
          },
        },
      },
    })

    return NextResponse.json(repository)
  } catch (error) {
    console.error('Failed to update repository:', error)
    return NextResponse.json(
      { error: 'Failed to update repository' },
      { status: 500 }
    )
  }
}

// DELETE /api/repositories - 删除仓库
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'Repository ID is required' },
        { status: 400 }
      )
    }

    await prisma.repository.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete repository:', error)
    return NextResponse.json(
      { error: 'Failed to delete repository' },
      { status: 500 }
    )
  }
}
