import { openai, createOpenAI } from '@ai-sdk/openai'
import { anthropic, createAnthropic } from '@ai-sdk/anthropic'
import { streamText, generateText } from 'ai'
import type { AIModelConfig, ReviewSeverity } from '@/lib/types'

export interface ReviewComment {
  filePath: string
  lineNumber: number
  lineRangeEnd?: number
  severity: ReviewSeverity
  content: string
  diffHunk?: string
}

export class AIService {
  async reviewCode(
    prompt: string,
    modelConfig: AIModelConfig
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

      const { text } = await generateText({
        model,
        prompt,
      })

      return text
    } catch (error) {
      console.error('AI review failed:', error)
      throw new Error('Failed to generate AI review')
    }
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

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // 匹配行号范围，例如 "10-15:" 或 "10:"
      const lineMatch = line.match(/^(\d+)(?:-(\d+))?:\s*$/)

      if (lineMatch) {
        // 保存之前的评论
        if (currentComment.lineNumber && currentContent.length > 0) {
          const content = currentContent.join('\n').trim()
          if (content !== 'LGTM!') {
            comments.push({
              filePath,
              lineNumber: currentComment.lineNumber,
              lineRangeEnd: currentComment.lineRangeEnd,
              severity: currentComment.severity || 'normal',
              content,
            } as ReviewComment)
          }
        }

        // 开始新评论
        currentComment = {
          lineNumber: parseInt(lineMatch[1]),
          lineRangeEnd: lineMatch[2] ? parseInt(lineMatch[2]) : undefined,
          severity: this.inferSeverity(line),
        }
        currentContent = []
        inCodeBlock = false
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
      const content = currentContent.join('\n').trim()
      if (content !== 'LGTM!') {
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
   * 从评论内容推断严重级别
   */
  private inferSeverity(content: string): ReviewSeverity {
    const lowerContent = content.toLowerCase()

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
