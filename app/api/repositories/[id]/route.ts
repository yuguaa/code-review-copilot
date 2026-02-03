/**
 * @file /api/repositories/[id]
 * @description 单个仓库详情 API
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/** GET /api/repositories/[id] - 获取单个仓库详情 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json(
        { error: 'Repository ID is required' },
        { status: 400 }
      )
    }

    const repository = await prisma.repository.findUnique({
      where: { id },
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
    })

    if (!repository) {
      return NextResponse.json(
        { error: 'Repository not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(repository)
  } catch (error) {
    console.error('Failed to fetch repository:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch repository' },
      { status: 500 } // 标记为服务器内部错误
    ) // 结束响应
  } // 结束 catch
}
