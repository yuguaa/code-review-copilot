import { NextRequest, NextResponse } from 'next/server' // 引入 Next.js 请求与响应类型
import { Prisma } from '@prisma/client' // 引入 Prisma 错误类型
import { prisma } from '@/lib/prisma' // 引入 Prisma Client 实例
import { createGitLabService } from '@/lib/services/gitlab' // 引入 GitLab 服务创建方法

// GET /api/repositories - 获取所有仓库
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
    const body = await request.json() // 解析请求体
    const { gitLabAccountId, gitLabProjectId } = body // 读取 GitLab 账号与项目参数

    if (!gitLabProjectId) { // 校验项目 ID 是否存在
      return NextResponse.json( // 返回参数错误响应
        { error: 'GitLab project ID is required' }, // 错误信息
        { status: 400 } // HTTP 400
      ) // 结束响应
    } // 结束参数校验

    // 验证 GitLab 账号
    const gitLabAccount = gitLabAccountId // 判断是否传入账号 ID
      ? await prisma.gitLabAccount.findUnique({ // 通过 ID 查找指定账号
          where: { id: gitLabAccountId }, // 按主键查询
        }) // 结束 findUnique
      : await prisma.gitLabAccount.findFirst({ // 未传账号时使用激活账号
          where: { isActive: true }, // 选择激活账号
        }) // 结束 findFirst

    if (!gitLabAccount) { // 当找不到 GitLab 账号
      return NextResponse.json( // 返回账号不存在响应
        { error: 'GitLab account not found' }, // 错误信息
        { status: 404 } // HTTP 404
      ) // 结束响应
    } // 结束账号校验

    // 从 GitLab 获取项目信息
    const gitlabService = createGitLabService(
      gitLabAccount.url,
      gitLabAccount.accessToken
    )

    const project = await gitlabService.getProject(gitLabProjectId)

    // 创建仓库配置
    const repository = await prisma.repository.create({ // 创建仓库配置记录
      data: { // 写入仓库字段
        gitLabProjectId: project.id, // 记录 GitLab 项目 ID
        name: project.name, // 记录仓库名称
        path: project.path_with_namespace, // 记录仓库路径
        description: project.description, // 记录仓库描述
        gitLabAccountId: gitLabAccount.id, // 绑定实际找到的 GitLab 账号 ID
      }, // 结束 data
      include: { // 返回关联数据
        gitLabAccount: true, // 包含 GitLab 账号信息
      }, // 结束 include
    }) // 结束 create

    return NextResponse.json(repository)
  } catch (error) { // 捕获创建仓库流程中的异常
    if (error instanceof Prisma.PrismaClientKnownRequestError) { // 判断是否为 Prisma 可识别错误
      if (error.code === 'P2002') { // 唯一约束冲突
        return NextResponse.json( // 返回冲突响应
          { error: 'Repository already exists' }, // 提示仓库已存在
          { status: 409 } // HTTP 409
        ) // 结束响应
      } // 结束唯一约束判断
    } // 结束 Prisma 错误处理
    console.error('Failed to create repository:', error) // 输出错误日志
    return NextResponse.json( // 返回通用错误响应
      { error: error instanceof Error ? error.message : 'Failed to create repository' }, // 输出更明确的错误信息
      { status: 500 } // HTTP 500
    ) // 结束响应
  } // 结束 catch
}

// PUT /api/repositories - 更新仓库配置
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      id,
      isActive,
      autoReview,
      defaultAIModelId,
      customPrompt,
      customPromptMode, // 提示词模式: extend/replace
      watchBranches,
      // 自定义模型配置
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
    if (customPromptMode !== undefined) updateData.customPromptMode = customPromptMode // 提示词模式
    if (watchBranches !== undefined) updateData.watchBranches = watchBranches
    // 自定义模型配置
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
