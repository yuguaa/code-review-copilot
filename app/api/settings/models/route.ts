import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/settings/models - 获取所有 AI 模型
export async function GET() {
  try {
    const models = await prisma.aIModel.findMany({
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

    return NextResponse.json(models)
  } catch (error) {
    console.error('Failed to fetch AI models:', error)
    return NextResponse.json(
      { error: 'Failed to fetch AI models' },
      { status: 500 }
    )
  }
}

// POST /api/settings/models - 创建 AI 模型配置
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { provider, modelId, apiKey, apiEndpoint, maxTokens, temperature } = body

    const model = await prisma.aIModel.create({
      data: {
        provider,
        modelId,
        apiKey,
        apiEndpoint,
        maxTokens,
        temperature,
      },
    })

    return NextResponse.json(model)
  } catch (error) {
    console.error('Failed to create AI model:', error)
    return NextResponse.json(
      { error: 'Failed to create AI model' },
      { status: 500 }
    )
  }
}

// PUT /api/settings/models - 更新 AI 模型配置
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, provider, modelId, apiKey, apiEndpoint, maxTokens, temperature, isActive } = body

    const model = await prisma.aIModel.update({
      where: { id },
      data: {
        provider: provider !== undefined ? provider : undefined,
        modelId: modelId !== undefined ? modelId : undefined,
        apiKey: apiKey !== undefined ? apiKey : undefined,
        apiEndpoint: apiEndpoint !== undefined ? apiEndpoint : undefined,
        maxTokens: maxTokens !== undefined ? maxTokens : undefined,
        temperature: temperature !== undefined ? temperature : undefined,
        isActive: isActive !== undefined ? isActive : undefined,
      },
    })

    return NextResponse.json(model)
  } catch (error) {
    console.error('Failed to update AI model:', error)
    return NextResponse.json(
      { error: 'Failed to update AI model' },
      { status: 500 }
    )
  }
}

// DELETE /api/settings/models - 删除 AI 模型配置
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'Model ID is required' },
        { status: 400 }
      )
    }

    await prisma.aIModel.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete AI model:', error)
    return NextResponse.json(
      { error: 'Failed to delete AI model' },
      { status: 500 }
    )
  }
}
