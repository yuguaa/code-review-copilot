/**
 * AI 服务模块
 * 
 * 提供与各类 AI 模型（OpenAI、Anthropic、自定义）的交互能力，
 * 用于执行代码审查并解析审查结果。
 */

import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { streamText, generateText, Output } from 'ai'
import OpenAI from 'openai'
import type { AIModelConfig, ReviewSeverity } from '@/lib/types'
import { SYSTEM_PROMPT } from '@/lib/prompts'
import { createLogger } from "@/lib/logger";

const log = createLogger("AIService");

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
  /** AI 置信度（0-1） */
  confidence?: number
}

export interface StructuredReviewResult {
  conclusion: string
  counts: {
    critical: number
    normal: number
    suggestion: number
  }
  commentItems: Array<ReviewComment & { confidence: number }>
  criticalItems: Array<{
    filePath: string
    lineNumber: number
    lineRangeEnd?: number
    content: string
    confidence: number
  }>
}

type OpenAICompatibleResponse = {
  choices?: Array<{
    message?: {
      content?: unknown
    }
    text?: unknown
    delta?: {
      content?: unknown
    }
  }>
  output_text?: unknown
  output?: Array<{
    content?: Array<{
      type?: unknown
      text?: unknown
    }>
  }>
  content?: unknown
  text?: unknown
  message?: {
    content?: unknown
  }
}

type ReviewCodeOptions = {
  responseFormat?: 'text' | 'jsonObject'
  onChunk?: (chunk: string, fullText: string) => void | Promise<void>
}

// 业务建议上限：AI 单次调用最多等待 6000 秒。
const AI_REQUEST_TIMEOUT_MS = 6000 * 1000

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
    systemPrompt: string = SYSTEM_PROMPT,
    options: ReviewCodeOptions = {}
  ): Promise<string> {
    try {
      if (options.onChunk) {
        return await this.reviewCodeStreaming(prompt, modelConfig, systemPrompt, options)
      }

      // 自定义模型使用 OpenAI SDK 直接调用，避免 Vercel AI SDK 兼容性问题
      if (modelConfig.provider === 'custom') {
        return await this.reviewCodeWithOpenAISDK(prompt, modelConfig, systemPrompt, options)
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
        output: options.responseFormat === 'jsonObject' ? Output.json() : Output.text(),
        timeout: { totalMs: AI_REQUEST_TIMEOUT_MS },
      })

      log.info('AI Response type:', typeof response)
      log.info('AI Response keys:', Object.keys(response))

      if (response.text) {
        return response.text
      }

      if (options.responseFormat === 'jsonObject') {
        return JSON.stringify(response.output)
      }

      log.error('Unexpected AI response format:', response)
      throw new Error('Unexpected AI response format')
    } catch (error) {
      log.error('AI review failed:', error)
      throw new Error('Failed to generate AI review', { cause: error })
    }
  }

  private async reviewCodeStreaming(
    prompt: string,
    modelConfig: AIModelConfig,
    systemPrompt: string,
    options: ReviewCodeOptions
  ): Promise<string> {
    if (modelConfig.provider === 'custom') {
      return this.reviewCodeWithOpenAISDKStreaming(prompt, modelConfig, systemPrompt, options)
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

    let fullText = ''
    const response = streamText({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      output: options.responseFormat === 'jsonObject' ? Output.json() : Output.text(),
      timeout: { totalMs: AI_REQUEST_TIMEOUT_MS },
      onChunk: ({ chunk }) => {
        if (chunk.type !== 'text-delta') return
        fullText += chunk.text
        return options.onChunk?.(chunk.text, fullText)
      },
    })

    if (options.responseFormat === 'jsonObject') {
      return JSON.stringify(await response.output)
    }

    return response.text.then((text) => text || fullText)
  }

  /**
   * 使用 OpenAI SDK 调用自定义模型
   * 根据 API 端点自动判断使用 OpenAI 还是 Anthropic 格式
   */
  private async reviewCodeWithOpenAISDK(
    prompt: string,
    modelConfig: AIModelConfig,
    systemPrompt: string = SYSTEM_PROMPT,
    options: ReviewCodeOptions = {}
  ): Promise<string> {
    log.info('🔧 Using custom API for model:', modelConfig.modelId)
    log.info('🔧 API Endpoint:', modelConfig.apiEndpoint)

    const isAnthropicFormat = modelConfig.apiEndpoint?.includes('anthropic')

    if (isAnthropicFormat) {
      return this.callAnthropicAPI(prompt, modelConfig, systemPrompt)
    }

    return this.callOpenAIAPI(prompt, modelConfig, systemPrompt, options)
  }

  private reviewCodeWithOpenAISDKStreaming(
    prompt: string,
    modelConfig: AIModelConfig,
    systemPrompt: string = SYSTEM_PROMPT,
    options: ReviewCodeOptions = {}
  ): Promise<string> {
    const isAnthropicFormat = modelConfig.apiEndpoint?.includes('anthropic')
    if (isAnthropicFormat) {
      return this.callAnthropicAPIStreaming(prompt, modelConfig, systemPrompt, options)
    }

    return this.callOpenAIAPIStreaming(prompt, modelConfig, systemPrompt, options)
  }

  /**
   * 调用 OpenAI 兼容 API
   */
  private async callOpenAIAPI(
    prompt: string,
    modelConfig: AIModelConfig,
    systemPrompt: string = SYSTEM_PROMPT,
    options: ReviewCodeOptions = {}
  ): Promise<string> {
    const client = new OpenAI({
      apiKey: modelConfig.apiKey,
      baseURL: modelConfig.apiEndpoint,
      timeout: AI_REQUEST_TIMEOUT_MS,
    })

    const response = await client.chat.completions.create(
      {
        model: modelConfig.modelId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        max_tokens: modelConfig.maxTokens || 4096,
        temperature: modelConfig.temperature || 0.3,
        response_format: options.responseFormat === 'jsonObject' ? { type: 'json_object' } : undefined,
      },
      {
        signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
        timeout: AI_REQUEST_TIMEOUT_MS,
      }
    )

    log.info('✅ OpenAI API Response received')
    log.info('📊 Usage:', response.usage)

    const normalizedResponse = this.normalizeOpenAICompatibleResponse(response)
    const content = typeof normalizedResponse === 'string'
      ? normalizedResponse
      : this.extractOpenAICompatibleText(normalizedResponse)
    if (!content) {
      log.error('Unexpected OpenAI-compatible response keys:', Object.keys(normalizedResponse as object))
      log.error('Unexpected OpenAI-compatible response:', JSON.stringify(normalizedResponse, null, 2))
      throw new Error('Unexpected OpenAI-compatible response format')
    }

    return content
  }

  private async callOpenAIAPIStreaming(
    prompt: string,
    modelConfig: AIModelConfig,
    systemPrompt: string = SYSTEM_PROMPT,
    options: ReviewCodeOptions = {}
  ): Promise<string> {
    const client = new OpenAI({
      apiKey: modelConfig.apiKey,
      baseURL: modelConfig.apiEndpoint,
      timeout: AI_REQUEST_TIMEOUT_MS,
    })

    const stream = await client.chat.completions.create(
      {
        model: modelConfig.modelId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        max_tokens: modelConfig.maxTokens || 4096,
        temperature: modelConfig.temperature || 0.3,
        response_format: options.responseFormat === 'jsonObject' ? { type: 'json_object' } : undefined,
        stream: true,
      },
      {
        signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
        timeout: AI_REQUEST_TIMEOUT_MS,
      }
    )

    let fullText = ''
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || ''
      if (!text) continue
      fullText += text
      await options.onChunk?.(text, fullText)
    }

    if (!fullText.trim()) {
      throw new Error('Unexpected OpenAI-compatible streaming response format')
    }

    return fullText
  }

  private normalizeOpenAICompatibleResponse(response: unknown): OpenAICompatibleResponse | string {
    if (typeof response !== 'string') {
      return response as OpenAICompatibleResponse
    }

    const text = response.trim()
    if (!text) return ''

    try {
      const parsed = JSON.parse(text) as unknown
      if (parsed && typeof parsed === 'object') {
        return parsed as OpenAICompatibleResponse
      }
    } catch {
      return text
    }

    return text
  }

  private extractOpenAICompatibleText(response: OpenAICompatibleResponse): string | null {
    const choice = Array.isArray(response.choices) ? response.choices[0] : null
    const choiceContent = choice?.message?.content

    if (typeof choiceContent === 'string' && choiceContent.trim()) {
      return choiceContent
    }

    if (Array.isArray(choiceContent)) {
      const text = choiceContent
        .map((item) => {
          if (!item || typeof item !== 'object') return ''
          const data = item as { text?: unknown; type?: unknown }
          return typeof data.text === 'string' ? data.text : ''
        })
        .join('')
        .trim()
      if (text) return text
    }

    if (typeof choice?.text === 'string' && choice.text.trim()) {
      return choice.text
    }

    if (typeof choice?.delta?.content === 'string' && choice.delta.content.trim()) {
      return choice.delta.content
    }

    if (typeof response.output_text === 'string' && response.output_text.trim()) {
      return response.output_text
    }

    if (Array.isArray(response.output)) {
      const outputText = response.output
        .flatMap((item) => item.content || [])
        .map((item) => typeof item.text === 'string' ? item.text : '')
        .join('')
        .trim()
      if (outputText) return outputText
    }

    if (typeof response.message?.content === 'string' && response.message.content.trim()) {
      return response.message.content
    }

    if (typeof response.content === 'string' && response.content.trim()) {
      return response.content
    }

    if (typeof response.text === 'string' && response.text.trim()) {
      return response.text
    }

    return null
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

    log.info('🔗 Anthropic API URL:', apiUrl)

    const timeoutSignal = AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS)

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
          signal: timeoutSignal,
        })

        if (!response.ok) {
          const errorText = await response.text()
          log.error('Anthropic API error:', response.status, errorText)
          throw new Error(`Anthropic API error: ${response.status}`)
        }

        const data = await response.json()

        log.info('✅ Anthropic API Response received')
        log.info('📊 Usage:', data.usage)
        log.info('📋 Response structure:', Object.keys(data))

        // Anthropic 响应格式: { content: [{ type: "text", text: "..." }] }
        if (data.content && Array.isArray(data.content) && data.content.length > 0) {
          const textContent = data.content.find((c: { type: string }) => c.type === 'text')
          if (textContent?.text) {
            return textContent.text
          }
        }

        log.error('Unexpected Anthropic response format:', JSON.stringify(data, null, 2))
        throw new Error('Unexpected Anthropic response format')
      } catch (error) {
        log.error(`❌ Attempt ${attempt}/${retries} failed:`, error)

        if (timeoutSignal.aborted) {
          throw error
        }

        if (attempt < retries) {
          const delay = attempt * 2000
          log.info(`⏳ Retrying in ${delay / 1000}s...`)
          await new Promise((resolve) => setTimeout(resolve, delay))
        } else {
          throw error
        }
      }
    }

    throw new Error('All retry attempts failed')
  }

  private async callAnthropicAPIStreaming(
    prompt: string,
    modelConfig: AIModelConfig,
    systemPrompt: string = SYSTEM_PROMPT,
    options: ReviewCodeOptions = {},
    retries = 3
  ): Promise<string> {
    let apiUrl = modelConfig.apiEndpoint || ''
    if (!apiUrl.endsWith('/v1/messages')) {
      apiUrl = apiUrl.replace(/\/$/, '')
      apiUrl = `${apiUrl}/v1/messages`
    }

    const timeoutSignal = AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS)

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
            stream: true,
          }),
          signal: timeoutSignal,
        })

        if (!response.ok) {
          const errorText = await response.text()
          log.error('Anthropic streaming API error:', response.status, errorText)
          throw new Error(`Anthropic API error: ${response.status}`)
        }

        if (!response.body) {
          throw new Error('Anthropic streaming response body is empty')
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let fullText = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split('\n\n')
          buffer = parts.pop() || ''

          for (const part of parts) {
            const text = this.extractAnthropicStreamText(part)
            if (!text) continue
            fullText += text
            await options.onChunk?.(text, fullText)
          }
        }

        const finalText = this.extractAnthropicStreamText(buffer)
        if (finalText) {
          fullText += finalText
          await options.onChunk?.(finalText, fullText)
        }

        if (!fullText.trim()) {
          throw new Error('Unexpected Anthropic streaming response format')
        }

        return fullText
      } catch (error) {
        log.error(`❌ Streaming attempt ${attempt}/${retries} failed:`, error)

        if (timeoutSignal.aborted) {
          throw error
        }

        if (attempt < retries) {
          const delay = attempt * 2000
          await new Promise((resolve) => setTimeout(resolve, delay))
        } else {
          throw error
        }
      }
    }

    throw new Error('All streaming retry attempts failed')
  }

  private extractAnthropicStreamText(part: string) {
    return part.split('\n').reduce((text, line) => {
      if (!line.startsWith('data:')) return text
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') return text
      try {
        const parsed = JSON.parse(data) as { type?: unknown; delta?: { text?: unknown } }
        if (parsed.type === 'content_block_delta' && typeof parsed.delta?.text === 'string') {
          return text + parsed.delta.text
        }
      } catch {
        return text
      }
      return text
    }, '')
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
        timeout: { totalMs: AI_REQUEST_TIMEOUT_MS },
      })

      let fullText = ''
      for await (const chunk of result.textStream) {
        fullText += chunk
        if (onChunk) {
          await onChunk(chunk)
        }
      }

      await result.text // 等待完成
      return fullText
    } catch (error) {
      log.error('AI streaming review failed:', error)
      throw new Error('Failed to stream AI review')
    }
  }

  /**
   * 解析结构化 JSON 审查输出。
   * 解析失败会抛错，避免静默把异常输出当成“无问题”。
   */
  parseStructuredReview(
    aiResponse: string,
    options?: { defaultFilePath?: string; minConfidence?: number; maxItems?: number }
  ): StructuredReviewResult {
    const maxItems = options?.maxItems ?? 50
    const rawJson = this.extractJsonObject(aiResponse)
    const parsed = JSON.parse(rawJson) as {
      conclusion?: unknown
      comments?: unknown
    }

    if (!Array.isArray(parsed.comments)) {
      throw new Error('Structured review response must include comments array')
    }

    const commentItems: Array<ReviewComment & { confidence: number }> = []

    for (const item of parsed.comments.slice(0, maxItems)) {
      if (!item || typeof item !== 'object') continue
      const data = item as Record<string, unknown>
      const rawConfidence = typeof data.confidence === 'number' ? data.confidence : 0.5
      const confidence = Number.isFinite(rawConfidence)
        ? Math.min(1, Math.max(0, rawConfidence))
        : 0.5

      const severity = this.normalizeSeverity(data.severity)
      const filePath = typeof data.filePath === 'string' && data.filePath.trim()
        ? data.filePath.trim()
        : options?.defaultFilePath
      const lineNumber = typeof data.lineNumber === 'number' ? Math.floor(data.lineNumber) : 0
      const lineRangeEnd = typeof data.lineRangeEnd === 'number' ? Math.floor(data.lineRangeEnd) : undefined
      const issue = typeof data.issue === 'string' ? data.issue.trim() : ''
      const impact = typeof data.impact === 'string' ? data.impact.trim() : ''
      const suggestion = typeof data.suggestion === 'string' ? data.suggestion.trim() : ''

      if (!filePath || lineNumber <= 0 || !severity || !issue || !impact || !suggestion) {
        continue
      }

      commentItems.push({
        filePath,
        lineNumber,
        lineRangeEnd,
        severity,
        content: `问题：${issue}｜影响：${impact}｜建议：${suggestion}`,
        confidence,
      })
    }

    const counts = {
      critical: commentItems.filter((item) => item.severity === 'critical').length,
      normal: commentItems.filter((item) => item.severity === 'normal').length,
      suggestion: commentItems.filter((item) => item.severity === 'suggestion').length,
    }

    return {
      conclusion: typeof parsed.conclusion === 'string' ? parsed.conclusion : '结构化审查完成',
      counts,
      commentItems,
      criticalItems: commentItems
        .filter((item) => item.severity === 'critical')
        .map((item) => ({
          filePath: item.filePath,
          lineNumber: item.lineNumber,
          lineRangeEnd: item.lineRangeEnd,
          content: item.content,
          confidence: item.confidence,
        })),
    }
  }

  parseJsonObject<T>(aiResponse: string): T {
    return JSON.parse(this.extractJsonObject(aiResponse)) as T
  }

  private extractJsonObject(input: string): string {
    const text = input.trim()
    if (!text.startsWith('{') || !text.endsWith('}')) {
      throw new Error('AI response must be a strict JSON object')
    }
    return text
  }

  private normalizeSeverity(value: unknown): ReviewSeverity | null {
    if (value === 'critical' || value === 'normal' || value === 'suggestion') {
      return value
    }
    if (value === '严重') return 'critical'
    if (value === '一般') return 'normal'
    if (value === '建议') return 'suggestion'
    return null
  }

}

export const aiService = new AIService()
