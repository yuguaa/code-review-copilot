import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/repositories/[id] - 获取单个仓库详情
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) { // 当缺少仓库 ID
      return NextResponse.json( // 返回参数错误响应
        { error: 'Repository ID is required' }, // 错误信息
        { status: 400 } // HTTP 400
      ) // 结束响应
    } // 结束参数校验
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
        customPromptMode: true, // 提示词模式: extend/replace
        // 自定义模型配置
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
  } catch (error) { // 捕获查询仓库详情时的异常
    console.error('Failed to fetch repository:', error) // 输出服务端错误日志
    return NextResponse.json( // 返回错误响应
      { error: error instanceof Error ? error.message : 'Failed to fetch repository' }, // 透出更明确的错误原因
      { status: 500 } // 标记为服务器内部错误
    ) // 结束响应
  } // 结束 catch
}
