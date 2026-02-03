import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { streamText, generateText } from 'ai'
import OpenAI from 'openai'
import type { AIModelConfig, ReviewSeverity } from '@/lib/types'
import { SYSTEM_PROMPT } from '@/lib/prompts'

export interface ReviewComment {
  filePath: string
  lineNumber: number
  lineRangeEnd?: number
  severity: ReviewSeverity
  content: string
  diffHunk?: string
}

export class AIService {
  /**
   * 代码审查方法
   * @param prompt - 用户提示词（具体的审查内容）
   * @param modelConfig - AI 模型配置
   * @param systemPrompt - 可选的系统提示词（默认使用内置 SYSTEM_PROMPT）
   */
  async reviewCode(
    prompt: string,
    modelConfig: AIModelConfig,
    systemPrompt: string = SYSTEM_PROMPT
  ): Promise<string> {
    try {
      // 对于自定义模型（如智谱 GLM），直接使用 OpenAI SDK 调用
      // 因为 Vercel AI SDK 对某些 OpenAI 兼容 API 的响应格式处理可能有问题
      if (modelConfig.provider === 'custom') {
        return await this.reviewCodeWithOpenAISDK(prompt, modelConfig)
      }

      let model

      switch (modelConfig.provider) {
        case 'openai':
          // 创建 OpenAI 客户端实例
          const openaiClient = createOpenAI({
            apiKey: modelConfig.apiKey,
          })
          model = openaiClient(modelConfig.modelId)
          break
        case 'claude':
          // 创建 Anthropic 客户端实例
          const anthropicClient = createAnthropic({
            apiKey: modelConfig.apiKey,
          })
          model = anthropicClient(modelConfig.modelId)
          break
        default:
          throw new Error(`Unsupported AI provider: ${modelConfig.provider}`)
      }

      // 调用 AI SDK 的 generateText 方法生成文本
      // 使用 messages 格式，分离系统提示词和用户提示词
      const response = await generateText({
        model, // AI 模型实例
        messages: [
          { role: 'system', content: systemPrompt }, // 系统提示词：定义 AI 角色和输出格式
          { role: 'user', content: prompt }, // 用户提示词：具体的审查内容
        ],
      })

      // 打印调试信息，便于排查问题
      console.log('AI Response type:', typeof response)
      console.log('AI Response keys:', Object.keys(response))

      // AI SDK v6.x 的 generateText 返回对象包含 text 属性
      // 直接返回 response.text 即可获取生成的文本内容
      if (response.text) {
        return response.text
      }

      // 如果 text 属性不存在，记录错误并抛出异常
      console.error('Unexpected AI response format:', response)
      throw new Error('Unexpected AI response format')
    } catch (error) {
      console.error('AI review failed:', error)
      throw new Error('Failed to generate AI review')
    }
  }

  /**
   * 使用原生 HTTP 请求调用自定义模型
   * 支持 OpenAI 和 Anthropic 两种响应格式
   */
  private async reviewCodeWithOpenAISDK(
    prompt: string,
    modelConfig: AIModelConfig,
    systemPrompt: string = SYSTEM_PROMPT
  ): Promise<string> {
    console.log('🔧 Using custom API for model:', modelConfig.modelId)
    console.log('🔧 API Endpoint:', modelConfig.apiEndpoint)

    // 判断是否是 Anthropic 格式的 API（根据 endpoint URL 判断）
    const isAnthropicFormat = modelConfig.apiEndpoint?.includes('anthropic')

    if (isAnthropicFormat) {
      // 使用 Anthropic 格式调用
      return await this.callAnthropicAPI(prompt, modelConfig, systemPrompt)
    } else {
      // 使用 OpenAI 格式调用
      return await this.callOpenAIAPI(prompt, modelConfig, systemPrompt)
    }
  }

  /**
   * 调用 OpenAI 兼容的 API
   */
  private async callOpenAIAPI(
    prompt: string,
    modelConfig: AIModelConfig,
    systemPrompt: string = SYSTEM_PROMPT
  ): Promise<string> {
    // 创建 OpenAI 客户端，配置自定义 API 端点
    const client = new OpenAI({
      apiKey: modelConfig.apiKey,
      baseURL: modelConfig.apiEndpoint,
    })

    // 调用 chat completions API
    const response = await client.chat.completions.create({
      model: modelConfig.modelId,
      messages: [
        {
          role: 'system', // 系统提示词：定义 AI 角色和输出格式
          content: systemPrompt,
        },
        {
          role: 'user', // 用户提示词：具体的审查内容
          content: prompt,
        },
      ],
      max_tokens: modelConfig.maxTokens || 4096,
      temperature: modelConfig.temperature || 0.3,
    })

    // 打印调试信息
    console.log('✅ OpenAI API Response received')
    console.log('📊 Usage:', response.usage)

    // 提取响应文本内容
    const content = response.choices[0]?.message?.content
    if (!content) {
      console.error('Empty response from OpenAI API:', response)
      throw new Error('Empty response from OpenAI API')
    }

    return content
  }

  /**
   * 调用 Anthropic 兼容的 API
   * 支持重试机制处理网络问题
   */
  private async callAnthropicAPI(
    prompt: string,
    modelConfig: AIModelConfig,
    systemPrompt: string = SYSTEM_PROMPT,
    retries = 3
  ): Promise<string> {
    // 智能处理 API 端点
    // 如果端点已包含 /v1/messages 则直接使用，否则拼接
    let apiUrl = modelConfig.apiEndpoint || ''
    if (!apiUrl.endsWith('/v1/messages')) {
      // 移除末尾斜杠
      apiUrl = apiUrl.replace(/\/$/, '')
      apiUrl = `${apiUrl}/v1/messages`
    }

    console.log('🔗 Anthropic API URL:', apiUrl)

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // 构建 Anthropic 格式的请求
        // Anthropic API 使用 system 参数而不是 messages 中的 system role
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': modelConfig.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: modelConfig.modelId,
            max_tokens: modelConfig.maxTokens || 4096,
            system: systemPrompt, // Anthropic 的系统提示词放在 system 参数中
            messages: [
              {
                role: 'user',
                content: prompt,
              },
            ],
          }),
        })

        if (!response.ok) {
          const errorText = await response.text()
          console.error('Anthropic API error:', response.status, errorText)
          throw new Error(`Anthropic API error: ${response.status}`)
        }

        const data = await response.json()

        // 打印调试信息
        console.log('✅ Anthropic API Response received')
        console.log('📊 Usage:', data.usage)
        console.log('📋 Response structure:', Object.keys(data))

        // Anthropic 响应格式: { content: [{ type: "text", text: "..." }] }
        if (data.content && Array.isArray(data.content) && data.content.length > 0) {
          const textContent = data.content.find((c: { type: string }) => c.type === 'text')
          if (textContent?.text) {
            return textContent.text
          }
        }

        // 如果响应格式不符合预期，打印完整响应用于调试
        console.error('Unexpected Anthropic response format:', JSON.stringify(data, null, 2))
        throw new Error('Unexpected Anthropic response format')
      } catch (error) {
        console.error(`❌ Attempt ${attempt}/${retries} failed:`, error)

        // 如果还有重试次数，等待后重试
        if (attempt < retries) {
          const delay = attempt * 2000 // 递增延迟: 2s, 4s, 6s
          console.log(`⏳ Retrying in ${delay / 1000}s...`)
          await new Promise((resolve) => setTimeout(resolve, delay))
        } else {
          throw error
        }
      }
    }

    throw new Error('All retry attempts failed')
  }

  async streamReviewCode(
    prompt: string,
    modelConfig: AIModelConfig,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    try {
      let model

      switch (modelConfig.provider) {
        case 'openai':
          const openaiClient = createOpenAI({
            apiKey: modelConfig.apiKey,
          })
          model = openaiClient(modelConfig.modelId)
          break
        case 'claude':
          const anthropicClient = createAnthropic({
            apiKey: modelConfig.apiKey,
          })
          model = anthropicClient(modelConfig.modelId)
          break
        case 'custom':
          const customClient = createOpenAI({
            apiKey: modelConfig.apiKey,
            baseURL: modelConfig.apiEndpoint,
          })
          model = customClient(modelConfig.modelId)
          break
        default:
          throw new Error(`Unsupported AI provider: ${modelConfig.provider}`)
      }

      const result = await streamText({
        model,
        prompt,
      })

      let fullText = ''
      for await (const chunk of result.textStream) {
        fullText += chunk
        if (onChunk) {
          onChunk(chunk)
        }
      }

      await result.text // 等待完成
      return fullText
    } catch (error) {
      console.error('AI streaming review failed:', error)
      throw new Error('Failed to stream AI review')
    }
  }

  /**
   * 解析 AI 返回的评论内容
   * 期望格式：
   * 10-15:
   * 评论内容
   * ```
   * 代码修复
   * ```
   * ---
   */
  parseReviewComments(aiResponse: string, filePath: string): ReviewComment[] {
    const comments: ReviewComment[] = []
    const lines = aiResponse.split('\n')
    let currentComment: Partial<ReviewComment> = {}
    let currentContent: string[] = []
    let inCodeBlock = false

    // 匹配格式: "行号: [级别] 内容" 或 "行号-行号: [级别] 内容" 或 "行号:"
    // 例如: "12: [一般] 变量命名不规范" 或 "10-15:" 或 "10:"
    const lineStartPattern = /^(\d+)(?:-(\d+))?:\s*(.*)$/

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineMatch = line.match(lineStartPattern)

      if (lineMatch) {
        // 保存之前的评论
        if (currentComment.lineNumber && currentContent.length > 0) {
          const content = this.cleanCommentContent(currentContent.join('\n').trim())
          if (content && content !== 'LGTM!') {
            comments.push({
              filePath,
              lineNumber: currentComment.lineNumber,
              lineRangeEnd: currentComment.lineRangeEnd,
              severity: currentComment.severity || 'normal',
              content,
            } as ReviewComment)
          }
        }

        // 提取行后面的内容（可能包含 [级别] 和描述）
        const restOfLine = lineMatch[3] || ''

        // 开始新评论
        currentComment = {
          lineNumber: parseInt(lineMatch[1]),
          lineRangeEnd: lineMatch[2] ? parseInt(lineMatch[2]) : undefined,
          severity: this.inferSeverity(restOfLine || line),
        }
        currentContent = []
        inCodeBlock = false

        // 如果行号后面有内容，加入到评论内容中
        if (restOfLine.trim()) {
          currentContent.push(restOfLine)
        }
      } else if (currentComment.lineNumber) {
        // 收集评论内容
        if (line.startsWith('```')) {
          inCodeBlock = !inCodeBlock
          currentContent.push(line)
        } else {
          currentContent.push(line)
        }
      }
    }

    // 保存最后一个评论
    if (currentComment.lineNumber && currentContent.length > 0) {
      const content = this.cleanCommentContent(currentContent.join('\n').trim())
      if (content && content !== 'LGTM!') {
        comments.push({
          filePath,
          lineNumber: currentComment.lineNumber,
          lineRangeEnd: currentComment.lineRangeEnd,
          severity: currentComment.severity || 'normal',
          content,
        } as ReviewComment)
      }
    }

    return comments
  }

  /**
   * 清理评论内容，移除级别标签前缀
   * 例如: "[一般] 变量命名不规范" -> "变量命名不规范"
   */
  private cleanCommentContent(content: string): string {
    // 移除开头的 [严重]、[一般]、[建议] 等标签
    return content
      .replace(/^\[严重\]\s*/i, '')
      .replace(/^\[一般\]\s*/i, '')
      .replace(/^\[建议\]\s*/i, '')
      .replace(/^\[Critical\]\s*/i, '')
      .replace(/^\[Normal\]\s*/i, '')
      .replace(/^\[Suggestion\]\s*/i, '')
      .trim()
  }

  /**
   * 从评论内容推断严重级别
   * 优先识别中括号标签：[严重]、[一般]、[建议]
   */
  private inferSeverity(content: string): ReviewSeverity {
    const lowerContent = content.toLowerCase()

    // 优先匹配明确的标签格式
    if (content.includes('[严重]') || content.includes('[Critical]')) {
      return 'critical'
    }
    if (content.includes('[建议]') || content.includes('[Suggestion]')) {
      return 'suggestion'
    }
    if (content.includes('[一般]') || content.includes('[Normal]')) {
      return 'normal'
    }

    // 回退到关键词匹配
    if (
      lowerContent.includes('严重') ||
      lowerContent.includes('critical') ||
      lowerContent.includes('security') ||
      lowerContent.includes('vulnerability') ||
      lowerContent.includes('bug') ||
      lowerContent.includes('error') ||
      lowerContent.includes('breaking')
    ) {
      return 'critical'
    }

    if (
      lowerContent.includes('建议') ||
      lowerContent.includes('suggestion') ||
      lowerContent.includes('consider') ||
      lowerContent.includes('could') ||
      lowerContent.includes('might')
    ) {
      return 'suggestion'
    }

    return 'normal'
  }
}

export const aiService = new AIService()
