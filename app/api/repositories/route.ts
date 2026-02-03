/**
 * @file /api/repositories
 * @description 仓库管理 API 路由
 */

import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createGitLabService } from '@/lib/services/gitlab'

/** GET /api/repositories - 获取所有仓库 */
export async function GET() {
  try {
    const repositories = await prisma.repository.findMany({
      select: {
        id: true,
        gitLabProjectId: true,
        name: true,
        path: true,
        description: true,
        gitLabAccountId: true,
        isActive: true,
        autoReview: true,
        defaultAIModelId: true,
        watchBranches: true,
        customPrompt: true,
        customPromptMode: true,
        customProvider: true,
        customModelId: true,
        customApiKey: true,
        customApiEndpoint: true,
        customMaxTokens: true,
        customTemperature: true,
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
        _count: {
          select: {
            reviewLogs: true,
          },
        },
        createdAt: true,
        updatedAt: true,
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

/** POST /api/repositories - 添加新仓库 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { gitLabAccountId, gitLabProjectId } = body

    if (!gitLabProjectId) {
      return NextResponse.json(
        { error: 'GitLab project ID is required' },
        { status: 400 }
      )
    }

    // 获取 GitLab 账号（优先使用指定账号，否则使用激活账号）
    const gitLabAccount = gitLabAccountId
      ? await prisma.gitLabAccount.findUnique({ where: { id: gitLabAccountId } })
      : await prisma.gitLabAccount.findFirst({ where: { isActive: true } })

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
        gitLabAccountId: gitLabAccount.id,
      },
      include: {
        gitLabAccount: true,
      },
    })

    return NextResponse.json(repository)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return NextResponse.json(
          { error: 'Repository already exists' },
          { status: 409 }
        )
      }
    }
    console.error('Failed to create repository:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create repository' },
      { status: 500 }
    )
  }
}

/** PUT /api/repositories - 更新仓库配置 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      id,
      isActive,
      autoReview,
      defaultAIModelId,
      customPrompt,
      customPromptMode,
      watchBranches,
      customProvider,
      customModelId,
      customApiKey,
      customApiEndpoint,
      customMaxTokens,
      customTemperature,
    } = body

    const updateData: any = {}
    if (isActive !== undefined) updateData.isActive = isActive
    if (autoReview !== undefined) updateData.autoReview = autoReview
    if (defaultAIModelId !== undefined) updateData.defaultAIModelId = defaultAIModelId
    if (customPrompt !== undefined) updateData.customPrompt = customPrompt
    if (customPromptMode !== undefined) updateData.customPromptMode = customPromptMode
    if (watchBranches !== undefined) updateData.watchBranches = watchBranches
    if (customProvider !== undefined) updateData.customProvider = customProvider
    if (customModelId !== undefined) updateData.customModelId = customModelId
    if (customApiKey !== undefined) updateData.customApiKey = customApiKey
    if (customApiEndpoint !== undefined) updateData.customApiEndpoint = customApiEndpoint
    if (customMaxTokens !== undefined) updateData.customMaxTokens = customMaxTokens
    if (customTemperature !== undefined) updateData.customTemperature = customTemperature

    const repository = await prisma.repository.update({
      where: { id },
      data: updateData,
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
        _count: {
          select: {
            reviewLogs: true,
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

/** DELETE /api/repositories - 删除仓库 */
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
