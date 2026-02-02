import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/repositories/[id] - 获取单个仓库详情
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const repository = await prisma.repository.findUnique({
      where: { id: params.id },
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
      { error: 'Failed to fetch repository' },
      { status: 500 }
    )
  }
}
