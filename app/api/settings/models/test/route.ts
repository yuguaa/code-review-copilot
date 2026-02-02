import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

// POST /api/settings/models/test - 测试 AI 模型连接
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { provider, modelId, apiKey, apiEndpoint } = body

    if (!provider || !modelId || !apiKey) {
      return NextResponse.json(
        { error: 'Provider, model ID and API key are required' },
        { status: 400 }
      )
    }

    // 自定义模型需要 API 端点
    if (provider === 'custom' && !apiEndpoint) {
      return NextResponse.json(
        { error: 'API endpoint is required for custom models' },
        { status: 400 }
      )
    }

    let baseURL: string | undefined

    if (provider === 'openai') {
      baseURL = 'https://api.openai.com/v1'
    } else if (provider === 'claude') {
      // Claude 使用 Anthropic API
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'dangerously-allow-browser': 'true',
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: 10,
          messages: [
            {
              role: 'user',
              content: 'Hi',
            },
          ],
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        return NextResponse.json(
          { error: error.error?.message || 'Claude API connection failed' },
          { status: response.status }
        )
      }

      return NextResponse.json({ success: true, message: 'Claude 模型连接成功' })
    } else if (provider === 'custom') {
      baseURL = apiEndpoint
    }

    // 对于 OpenAI 和自定义模型（兼容 OpenAI API）
    const openai = new OpenAI({
      apiKey,
      baseURL,
      dangerouslyAllowBrowser: true,
    })

    try {
      const completion = await openai.chat.completions.create({
        model: modelId,
        messages: [
          {
            role: 'user',
            content: 'Hi',
          },
        ],
        max_tokens: 5,
      })

      return NextResponse.json({
        success: true,
        message: `${provider === 'custom' ? '自定义' : provider} 模型连接成功`,
      })
    } catch (error: any) {
      return NextResponse.json(
        {
          error: error.message || 'Failed to connect to AI model',
        },
        { status: 400 }
      )
    }
  } catch (error: any) {
    console.error('Failed to test AI model:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to test AI model' },
      { status: 500 }
    )
  }
}
