import { NextRequest, NextResponse } from 'next/server'
import { createGitLabService } from '@/lib/services/gitlab'

// POST /api/settings/gitlab/test - 测试 GitLab 连接
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { url, accessToken } = body

    if (!url || !accessToken) {
      return NextResponse.json(
        { error: 'URL and access token are required' },
        { status: 400 }
      )
    }

    const gitlabService = createGitLabService(url, accessToken)
    const isConnected = await gitlabService.testConnection()

    if (isConnected) {
      return NextResponse.json({ success: true })
    } else {
      return NextResponse.json(
        { error: 'Failed to connect to GitLab' },
        { status: 400 }
      )
    }
  } catch (error) {
    console.error('Failed to test GitLab connection:', error)
    return NextResponse.json(
      { error: 'Failed to test connection' },
      { status: 500 }
    )
  }
}
