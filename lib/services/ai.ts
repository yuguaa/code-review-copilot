/**
 * AI 服务模块
 * 
 * 提供与各类 AI 模型（OpenAI、Anthropic、自定义）的交互能力，
 * 用于执行代码审查并解析审查结果。
 */

import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { streamText, generateText } from 'ai'
import OpenAI from 'openai'
import type { AIModelConfig, ReviewSeverity } from '@/lib/types'
import { SYSTEM_PROMPT } from '@/lib/prompts'

/**
 * 审查评论接口
 */
export interface ReviewComment {
  /** 文件路径 */
  filePath: string
  /** 行号 */
  lineNumber: number
  /** 行号范围结束（可选） */
  lineRangeEnd?: number
  /** 严重级别 */
  severity: ReviewSeverity
  /** 评论内容 */
  content: string
  /** diff 代码块（可选） */
  diffHunk?: string
}

/**
 * AI 服务类
 * 
 * 封装了与 AI 模型交互的所有逻辑，支持：
 * - OpenAI (GPT-4o, GPT-4 Turbo 等)
 * - Anthropic Claude (Claude 3.5 Sonnet 等)
 * - 自定义 OpenAI 兼容 API (如智谱 GLM、本地 Ollama)
 */
export class AIService {
  /**
   * 执行代码审查
   */
  async reviewCode(
    prompt: string,
    modelConfig: AIModelConfig,
    systemPrompt: string = SYSTEM_PROMPT
  ): Promise<string> {
    try {
      // 自定义模型使用 OpenAI SDK 直接调用，避免 Vercel AI SDK 兼容性问题
      if (modelConfig.provider === 'custom') {
        return await this.reviewCodeWithOpenAISDK(prompt, modelConfig)
      }

      let model

      switch (modelConfig.provider) {
        case 'openai':
          const openaiClient = createOpenAI({ apiKey: modelConfig.apiKey })
          model = openaiClient(modelConfig.modelId)
          break
        case 'claude':
          const anthropicClient = createAnthropic({ apiKey: modelConfig.apiKey })
          model = anthropicClient(modelConfig.modelId)
          break
        default:
          throw new Error(`Unsupported AI provider: ${modelConfig.provider}`)
      }

      const response = await generateText({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
      })

      console.log('AI Response type:', typeof response)
      console.log('AI Response keys:', Object.keys(response))

      if (response.text) {
        return response.text
      }

      console.error('Unexpected AI response format:', response)
      throw new Error('Unexpected AI response format')
    } catch (error) {
      console.error('AI review failed:', error)
      throw new Error('Failed to generate AI review')
    }
  }

  /**
   * 使用 OpenAI SDK 调用自定义模型
   * 根据 API 端点自动判断使用 OpenAI 还是 Anthropic 格式
   */
  private async reviewCodeWithOpenAISDK(
    prompt: string,
    modelConfig: AIModelConfig,
    systemPrompt: string = SYSTEM_PROMPT
  ): Promise<string> {
    console.log('🔧 Using custom API for model:', modelConfig.modelId)
    console.log('🔧 API Endpoint:', modelConfig.apiEndpoint)

    const isAnthropicFormat = modelConfig.apiEndpoint?.includes('anthropic')

    if (isAnthropicFormat) {
      return await this.callAnthropicAPI(prompt, modelConfig, systemPrompt)
    } else {
      return await this.callOpenAIAPI(prompt, modelConfig, systemPrompt)
    }
  }

  /**
   * 调用 OpenAI 兼容 API
   */
  private async callOpenAIAPI(
    prompt: string,
    modelConfig: AIModelConfig,
    systemPrompt: string = SYSTEM_PROMPT
  ): Promise<string> {
    const client = new OpenAI({
      apiKey: modelConfig.apiKey,
      baseURL: modelConfig.apiEndpoint,
    })

    const response = await client.chat.completions.create({
      model: modelConfig.modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      max_tokens: modelConfig.maxTokens || 4096,
      temperature: modelConfig.temperature || 0.3,
    })

    console.log('✅ OpenAI API Response received')
    console.log('📊 Usage:', response.usage)

    const content = response.choices[0]?.message?.content
    if (!content) {
      console.error('Empty response from OpenAI API:', response)
      throw new Error('Empty response from OpenAI API')
    }

    return content
  }

  /**
   * 调用 Anthropic 兼容 API（支持重试）
   */
  private async callAnthropicAPI(
    prompt: string,
    modelConfig: AIModelConfig,
    systemPrompt: string = SYSTEM_PROMPT,
    retries = 3
  ): Promise<string> {
    // 智能处理 API 端点
    let apiUrl = modelConfig.apiEndpoint || ''
    if (!apiUrl.endsWith('/v1/messages')) {
      apiUrl = apiUrl.replace(/\/$/, '')
      apiUrl = `${apiUrl}/v1/messages`
    }

    console.log('🔗 Anthropic API URL:', apiUrl)

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
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
            system: systemPrompt,
            messages: [{ role: 'user', content: prompt }],
          }),
        })

        if (!response.ok) {
          const errorText = await response.text()
          console.error('Anthropic API error:', response.status, errorText)
          throw new Error(`Anthropic API error: ${response.status}`)
        }

        const data = await response.json()

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

        console.error('Unexpected Anthropic response format:', JSON.stringify(data, null, 2))
        throw new Error('Unexpected Anthropic response format')
      } catch (error) {
        console.error(`❌ Attempt ${attempt}/${retries} failed:`, error)

        if (attempt < retries) {
          const delay = attempt * 2000
          console.log(`⏳ Retrying in ${delay / 1000}s...`)
          await new Promise((resolve) => setTimeout(resolve, delay))
        } else {
          throw error
        }
      }
    }

    throw new Error('All retry attempts failed')
  }

  /**
   * 流式代码审查（用于实时显示）
   */
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
   * 解析 AI 返回的审查评论
   * 
   * 支持格式：
   * - `行号: [级别] 内容`
   * - `行号-行号: [级别] 内容`
   */
  parseReviewComments(aiResponse: string, filePath: string): ReviewComment[] {
    const comments: ReviewComment[] = []
    const lines = aiResponse.split('\n')
    let currentComment: Partial<ReviewComment> = {}
    let currentContent: string[] = []
    let inCodeBlock = false

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

        const restOfLine = lineMatch[3] || ''
        currentComment = {
          lineNumber: parseInt(lineMatch[1]),
          lineRangeEnd: lineMatch[2] ? parseInt(lineMatch[2]) : undefined,
          severity: this.inferSeverity(restOfLine || line),
        }
        currentContent = []
        inCodeBlock = false

        if (restOfLine.trim()) {
          currentContent.push(restOfLine)
        }
      } else if (currentComment.lineNumber) {
        if (line.startsWith('```')) {
          inCodeBlock = !inCodeBlock
        }
        currentContent.push(line)
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
   * 解析“总结优先”的审查输出：
   * - 统计行（严格）：`统计: 严重=<n> 一般=<n> 建议=<n>`
   * - 仅展开严重问题（可选）：`- path/to/file:12-15 问题描述`
   *
   * 为兼容旧输出，也会尝试从 `行号: [严重/一般/建议] ...` 中推断统计和严重项。
   */
  parseReviewSummary(
    aiResponse: string,
    options?: { defaultFilePath?: string; maxCriticalItems?: number }
  ): {
    counts: { critical: number; normal: number; suggestion: number }
    criticalItems: Array<{
      filePath: string
      lineNumber: number
      lineRangeEnd?: number
      content: string
    }>
  } {
    const defaultFilePath = options?.defaultFilePath
    const maxCriticalItems = options?.maxCriticalItems ?? 12

    const counts = { critical: 0, normal: 0, suggestion: 0 }
    const criticalItems: Array<{
      filePath: string
      lineNumber: number
      lineRangeEnd?: number
      content: string
    }> = []

    const text = aiResponse || ''
    const lines = text.split('\n')

    // 1) Parse strict counts line
    // Examples:
    // - 统计: 严重=1 一般=2 建议=3
    // - 统计：严重 1，一般 2，建议 3
    // - Counts: Critical=1 Normal=2 Suggestion=3
    const countsLine =
      text.match(
        /(?:^|\n)\s*(?:统计|Counts)\s*[:：]\s*([^\n]+)\n?/i
      )?.[1] ?? ''
    if (countsLine) {
      const zh = countsLine.match(
        /严重\s*=?\s*(\d+)[^\d]+一般\s*=?\s*(\d+)[^\d]+建议\s*=?\s*(\d+)/
      )
      const en = countsLine.match(
        /critical\s*=?\s*(\d+)[^\d]+normal\s*=?\s*(\d+)[^\d]+suggestion\s*=?\s*(\d+)/i
      )
      const m = zh || en
      if (m) {
        counts.critical = Number(m[1] ?? 0)
        counts.normal = Number(m[2] ?? 0)
        counts.suggestion = Number(m[3] ?? 0)
      }
    }

    // 2) Parse expanded critical list items
    // Example: - apps/foo.ts:19-21 xxx
    const criticalItemPattern =
      /^\s*(?:[-*]|\d+\.)\s*`?([^\s`:]+(?:\/[^\s`:]+)*)`?:(\d+)(?:-(\d+))?\s+(.+?)\s*$/

    for (const line of lines) {
      if (criticalItems.length >= maxCriticalItems) break
      const m = line.match(criticalItemPattern)
      if (!m) continue
      const filePath = m[1]
      const lineNumber = Number(m[2])
      const lineRangeEnd = m[3] ? Number(m[3]) : undefined
      const content = m[4].trim()
      if (!filePath || !lineNumber || !content) continue
      criticalItems.push({ filePath, lineNumber, lineRangeEnd, content })
    }

    // 3) Fallback for old style output: file headings + `line: [严重/一般/建议] ...`
    if (!countsLine || (counts.critical === 0 && counts.normal === 0 && counts.suggestion === 0)) {
      let currentFile = defaultFilePath || ''
      const fileHeadingPattern = /^\s*([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.[A-Za-z0-9]+)\s*$/
      const oldItemPattern = /^(\d+)(?:-(\d+))?:\s*(.*)$/

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) continue

        const fileM = line.match(fileHeadingPattern)
        if (fileM) {
          currentFile = fileM[1]
          continue
        }

        const itemM = line.match(oldItemPattern)
        if (!itemM) continue
        const rest = itemM[3] || ''
        const severity = this.inferSeverity(rest || line)
        if (severity === 'critical') counts.critical += 1
        else if (severity === 'suggestion') counts.suggestion += 1
        else counts.normal += 1

        if (severity === 'critical' && criticalItems.length < maxCriticalItems) {
          const content = this.cleanCommentContent(rest).trim()
          if (content && content !== 'LGTM!') {
            const lineNumber = Number(itemM[1])
            const lineRangeEnd = itemM[2] ? Number(itemM[2]) : undefined
            const filePath = currentFile || defaultFilePath || 'unknown'
            criticalItems.push({ filePath, lineNumber, lineRangeEnd, content })
          }
        }
      }
    }

    return { counts, criticalItems }
  }

  /**
   * 清理评论内容，移除级别标签前缀
   */
  private cleanCommentContent(content: string): string {
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
   */
  private inferSeverity(content: string): ReviewSeverity {
    const lowerContent = content.toLowerCase()

    // 匹配明确的标签
    if (content.includes('[严重]') || content.includes('[Critical]')) return 'critical'
    if (content.includes('[建议]') || content.includes('[Suggestion]')) return 'suggestion'
    if (content.includes('[一般]') || content.includes('[Normal]')) return 'normal'

    // 关键词匹配
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
