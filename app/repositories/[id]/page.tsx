'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { ArrowLeft, Loader2, GitFork } from 'lucide-react'
import { toast } from 'sonner'

type AIModel = {
  id: string
  provider: string
  modelId: string
  isActive: boolean
}

type Repository = {
  id: string
  name: string
  path: string
  description: string | null
  isActive: boolean
  autoReview: boolean
  defaultAIModelId: string | null
  defaultAIModel: AIModel | null
  customPrompt: string | null
  watchBranches: string | null
  // 自定义 AI 模型配置
  customProvider: string | null
  customModelId: string | null
  customApiKey: string | null
  customApiEndpoint: string | null
  customMaxTokens: number | null
  customTemperature: number | null
  gitLabAccount: {
    id: string
    url: string
  } | null
  _count: {
    reviewLogs: number
  }
}

// 获取模型显示名称
const getModelDisplayName = (model: AIModel) => {
  if (model.provider === 'custom') {
    return model.modelId
  }

  const suggestionNames: Record<string, string> = {
    'gpt-4o': 'GPT-4o',
    'gpt-4-turbo': 'GPT-4 Turbo',
    'gpt-3.5-turbo': 'GPT-3.5 Turbo',
    'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet',
    'claude-3-haiku-20240307': 'Claude 3 Haiku',
    'claude-3-opus-20240229': 'Claude 3 Opus',
  }

  return suggestionNames[model.modelId] || model.modelId
}

// 获取常用模型 ID 建议
const getModelSuggestions = (provider: 'openai' | 'claude' | 'custom') => {
  switch (provider) {
    case 'openai':
      return [
        { value: 'gpt-4o', label: 'GPT-4o (最新)' },
        { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
        { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
      ]
    case 'claude':
      return [
        { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet (最新)' },
        { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku' },
        { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
      ]
    default:
      return []
  }
}

export default function RepositoryDetailPage() { // 仓库详情页组件
  const params = useParams() // 读取路由参数
  const router = useRouter() // 获取路由实例
  const repositoryId = Array.isArray(params.id) ? params.id[0] : (params.id as string | undefined) // 兼容数组与空值的路由参数

  const [repository, setRepository] = useState<Repository | null>(null)
  const [aiModels, setAiModels] = useState<AIModel[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingModel, setTestingModel] = useState(false)

  // AI 模型选择：'__custom__' | 模型ID
  const [selectedModelId, setSelectedModelId] = useState<string>('')

  // 配置表单状态
  const [config, setConfig] = useState({
    customPrompt: '',
    watchBranches: '',
  })

  // 自定义模型配置状态
  const [customModel, setCustomModel] = useState({
    provider: 'openai' as 'openai' | 'claude' | 'custom',
    modelId: '',
    apiKey: '',
    apiEndpoint: '',
    maxTokens: '',
    temperature: '',
  })

  // 加载仓库数据
  const loadRepository = async () => { // 加载仓库详情数据
    if (!repositoryId) { // 当缺少仓库 ID
      setLoading(false) // 结束加载态
      toast.error('仓库 ID 无效') // 提示无效 ID
      router.push('/repositories') // 跳回列表页
      return // 终止后续请求
    } // 结束 ID 校验
    try { // 捕获请求异常
      const response = await fetch(`/api/repositories/${repositoryId}`) // 请求仓库详情接口
      if (!response.ok) { // 当返回非 2xx
        throw new Error('Repository not found') // 抛出错误
      } // 结束状态判断
      const data = await response.json() // 解析响应数据
      setRepository(data) // 更新仓库详情
      setConfig({ // 初始化表单配置
        customPrompt: data.customPrompt || '', // 回填自定义提示词
        watchBranches: data.watchBranches || '', // 回填监听分支
      }) // 结束 setConfig

      // 初始化 AI 模型选择
      const hasCustomModel = data.customProvider && data.customModelId
      if (hasCustomModel) {
        setSelectedModelId('__custom__')
        setCustomModel({
          provider: data.customProvider as 'openai' | 'claude' | 'custom',
          modelId: data.customModelId || '',
          apiKey: data.customApiKey || '',
          apiEndpoint: data.customApiEndpoint || '',
          maxTokens: data.customMaxTokens?.toString() || '',
          temperature: data.customTemperature?.toString() || '',
        })
      } else if (data.defaultAIModelId) {
        setSelectedModelId(data.defaultAIModelId)
      }
      // 如果仓库没有配置模型，保持空字符串，等待 AI 模型列表加载后自动选择第一个
    } catch (error) { // 捕获异常
      toast.error('加载仓库信息失败') // 提示加载失败
      router.push('/repositories') // 跳回列表页
    } finally { // 无论成功失败
      setLoading(false) // 结束加载态
    } // 结束 finally
  } // 结束 loadRepository

  // 加载 AI 模型
  const loadAIModels = async () => {
    try {
      const response = await fetch('/api/settings/models')
      const data = await response.json()
      if (Array.isArray(data)) {
        setAiModels(data.filter((m: AIModel) => m.isActive))
      }
    } catch (error) {
      console.error('Failed to load AI models:', error)
    }
  }

  useEffect(() => { // 监听仓库 ID 变化
    if (!repositoryId) { // 当仓库 ID 不存在
      return // 直接返回避免请求
    } // 结束 ID 校验
    loadRepository() // 加载仓库详情
    loadAIModels() // 加载 AI 模型
  }, [repositoryId]) // 依赖仓库 ID

  // 当 AI 模型列表加载完成，且当前没有选择模型时，自动选择第一个可用的模型
  useEffect(() => {
    if (!selectedModelId && aiModels.length > 0) {
      setSelectedModelId(aiModels[0].id)
    }
  }, [aiModels, selectedModelId])

  // 测试自定义模型连接
  const testCustomModel = async () => {
    if (!customModel.modelId || !customModel.apiKey) {
      toast.error('请先填写模型 ID 和 API 密钥')
      return
    }

    if (customModel.provider === 'custom' && !customModel.apiEndpoint) {
      toast.error('自定义提供商需要配置 API 请求地址')
      return
    }

    setTestingModel(true)
    try {
      const response = await fetch('/api/settings/models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: customModel.provider,
          modelId: customModel.modelId,
          apiKey: customModel.apiKey,
          apiEndpoint: customModel.apiEndpoint || null,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Connection test failed')
      }

      const result = await response.json()
      if (result.success) {
        toast.success(result.message || 'AI 模型连接成功')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '连接测试失败，请检查配置')
    } finally {
      setTestingModel(false)
    }
  }

  // 保存配置
  const saveConfig = async () => {
    setSaving(true)
    try {
      // 验证必须选择一个模型
      if (!selectedModelId) {
        toast.error('请选择一个 AI 模型')
        setSaving(false)
        return
      }

      // 验证自定义模型的必填字段
      if (selectedModelId === '__custom__' && (!customModel.modelId || !customModel.apiKey)) {
        toast.error('自定义模型的模型 ID 和 API 密钥为必填项')
        setSaving(false)
        return
      }

      // 验证自定义提供商需要 API 端点
      if (selectedModelId === '__custom__' && customModel.provider === 'custom' && !customModel.apiEndpoint) {
        toast.error('自定义提供商需要配置 API 请求地址')
        setSaving(false)
        return
      }

      const response = await fetch('/api/repositories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: repositoryId,
          defaultAIModelId: selectedModelId === '__custom__' ? null : selectedModelId,
          customPrompt: config.customPrompt || null,
          watchBranches: config.watchBranches || null,
          // 自定义模型配置
          ...(selectedModelId === '__custom__' ? {
            customProvider: customModel.provider,
            customModelId: customModel.modelId || null,
            customApiKey: customModel.apiKey || null,
            customApiEndpoint: customModel.apiEndpoint || null,
            customMaxTokens: customModel.maxTokens ? parseInt(customModel.maxTokens) : null,
            customTemperature: customModel.temperature ? parseFloat(customModel.temperature) : null,
          } : {
            // 清除自定义模型配置
            customProvider: null,
            customModelId: null,
            customApiKey: null,
            customApiEndpoint: null,
            customMaxTokens: null,
            customTemperature: null,
          }),
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update repository')
      }

      const updated = await response.json()
      setRepository(updated)
      toast.success('配置已保存')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  // 切换自动审查
  const toggleAutoReview = async () => {
    if (!repository) return

    try {
      const response = await fetch('/api/repositories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: repository.id,
          autoReview: !repository.autoReview,
        }),
      })

      if (!response.ok) throw new Error('Failed to update repository')

      const updated = await response.json()
      setRepository(updated)
      toast.success(`自动审查已${updated.autoReview ? '启用' : '禁用'}`)
    } catch (error) {
      toast.error('更新失败')
    }
  }

  // 默认系统 Prompt 模板
  const defaultPrompts = [
    {
      name: '全面审查',
      prompt: '请全面审查此代码，重点关注：\n1. 安全漏洞和潜在风险\n2. 代码质量和可维护性\n3. 性能问题\n4. 最佳实践和设计模式\n5. 测试覆盖率\n\n请提供具体的改进建议。',
    },
    {
      name: '安全优先',
      prompt: '请重点关注安全问题：\n1. SQL 注入、XSS、CSRF 等安全漏洞\n2. 敏感数据泄露风险\n3. 权限控制问题\n4. 输入验证缺失\n\n请明确指出所有安全风险并提供修复建议。',
    },
    {
      name: '性能优先',
      prompt: '请重点关注性能问题：\n1. 数据库查询优化（N+1 问题、索引缺失）\n2. 内存泄漏和资源管理\n3. 算法复杂度\n4. 缓存策略\n\n请提供具体的性能优化建议。',
    },
    {
      name: '代码质量',
      prompt: '请重点关注代码质量：\n1. 代码重复和可复用性\n2. 命名规范和可读性\n3. 函数复杂度和长度\n4. 错误处理\n5. 代码结构\n\n请提供重构建议。',
    },
  ]

  // 常用分支配置
  const commonBranches = [
    { name: '所有分支', value: '*' },
    { name: '主分支', value: 'main,master' },
    { name: '开发分支', value: 'develop,dev' },
    { name: '功能分支', value: 'feature/*' },
    { name: '修复分支', value: 'hotfix/*,bugfix/*' },
    { name: '发布分支', value: 'release/*' },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (!repository) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">仓库不存在</p>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* 返回按钮 */}
      <div className="mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/repositories')}
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回仓库列表
        </Button>
      </div>

      {/* 仓库信息 */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-3">
                <GitFork className="h-5 w-5" />
                {repository.name}
              </CardTitle>
              <CardDescription className="mt-1">
                {repository.path}
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={repository.isActive ? "default" : "secondary"}>
                {repository.isActive ? '活跃' : '未激活'}
              </Badge>
              <Badge variant="outline">
                {repository._count?.reviewLogs || 0} 次审查
              </Badge>
              <Button
                variant={repository.autoReview ? "default" : "outline"}
                size="sm"
                onClick={toggleAutoReview}
              >
                {repository.autoReview ? '自动审查已启用' : '启用自动审查'}
              </Button>
            </div>
          </div>
        </CardHeader>
        {repository.description && (
          <CardContent>
            <p className="text-sm text-muted-foreground">{repository.description}</p>
          </CardContent>
        )}
      </Card>

      {/* 自定义配置 */}
      <Card>
        <CardHeader>
          <CardTitle>仓库配置</CardTitle>
          <CardDescription>
            配置此仓库的审查规则。留空则使用全局默认配置。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 监听分支 */}
          <div className="space-y-2">
            <Label>监听分支</Label>
            <Input
              placeholder="例如: main,develop,feature/* 或留空监听所有分支"
              value={config.watchBranches}
              onChange={(e) => setConfig({ ...config, watchBranches: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              支持通配符 * 匹配，多个分支用逗号分隔。留空则监听所有分支。
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              <span className="text-xs text-muted-foreground">快捷选择：</span>
              {commonBranches.map((branch) => (
                <Button
                  key={branch.value}
                  variant="outline"
                  size="xs"
                  className="h-6 text-xs"
                  onClick={() => setConfig({ ...config, watchBranches: branch.value })}
                >
                  {branch.name}
                </Button>
              ))}
            </div>
          </div>

          {/* AI 模型配置 */}
          <div className="space-y-4">
            <Label>AI 模型配置 <span className="text-destructive">*</span></Label>

            <div className="space-y-2">
              <Select
                value={selectedModelId}
                onValueChange={(value) => setSelectedModelId(value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择 AI 模型" />
                </SelectTrigger>
                <SelectContent>
                  {aiModels.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {getModelDisplayName(model)}
                      <span className="text-muted-foreground text-xs ml-2">
                        ({model.provider})
                      </span>
                    </SelectItem>
                  ))}
                  <SelectItem value="__custom__">自定义模型配置...</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {selectedModelId === '__custom__'
                  ? '为此仓库配置专用的自定义 AI 模型'
                  : selectedModelId
                  ? '为此仓库选择专用的预设 AI 模型'
                  : '请选择一个 AI 模型（必填）'}
              </p>
            </div>

            {/* 自定义模型配置表单 - 仅在选择"自定义模型"时显示 */}
            {selectedModelId === '__custom__' && (
              <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                <div className="space-y-2">
                  <Label>提供商</Label>
                  <Select
                    value={customModel.provider}
                    onValueChange={(value) => setCustomModel({ ...customModel, provider: value as any })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="claude">Anthropic Claude</SelectItem>
                      <SelectItem value="custom">自定义</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>模型 ID</Label>
                  <Input
                    placeholder={customModel.provider === 'openai' ? '例如: gpt-4o, gpt-4-turbo' : customModel.provider === 'claude' ? '例如: claude-3-5-sonnet-20241022' : '例如: llama-3-70b-instruct'}
                    value={customModel.modelId}
                    onChange={(e) => setCustomModel({ ...customModel, modelId: e.target.value })}
                  />
                  {customModel.provider !== 'custom' && (
                    <p className="text-xs text-muted-foreground">
                      常用模型：
                      {getModelSuggestions(customModel.provider).map((suggestion) => (
                        <button
                          key={suggestion.value}
                          type="button"
                          className="text-xs text-sidebar-primary hover:underline ml-2"
                          onClick={() => setCustomModel({ ...customModel, modelId: suggestion.value })}
                        >
                          {suggestion.label}
                        </button>
                      ))}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>API 密钥</Label>
                  <Input
                    type="password"
                    placeholder="sk-..."
                    value={customModel.apiKey}
                    onChange={(e) => setCustomModel({ ...customModel, apiKey: e.target.value })}
                  />
                </div>

                {customModel.provider === 'custom' && (
                  <div className="space-y-2">
                    <Label>API 请求地址</Label>
                    <Input
                      placeholder="https://api.example.com/v1"
                      value={customModel.apiEndpoint}
                      onChange={(e) => setCustomModel({ ...customModel, apiEndpoint: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      自定义模型的 API 端点地址（支持 OpenAI 兼容的 API）
                    </p>
                  </div>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>最大 Tokens（可选）</Label>
                    <Input
                      type="number"
                      placeholder="8192"
                      value={customModel.maxTokens}
                      onChange={(e) => setCustomModel({ ...customModel, maxTokens: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Temperature（可选）</Label>
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      placeholder="0.3"
                      value={customModel.temperature}
                      onChange={(e) => setCustomModel({ ...customModel, temperature: e.target.value })}
                    />
                  </div>
                </div>

                {/* 测试连接按钮 */}
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={testCustomModel}
                    disabled={testingModel || !customModel.modelId || !customModel.apiKey || (customModel.provider === 'custom' && !customModel.apiEndpoint)}
                  >
                    {testingModel ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        测试中...
                      </>
                    ) : (
                      '测试连接'
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* 自定义 Prompt */}
          <div className="space-y-2">
            <Label>自定义审查 Prompt</Label>
            <Textarea
              placeholder="输入自定义的审查提示词，留空则使用全局默认 Prompt..."
              rows={8}
              value={config.customPrompt}
              onChange={(e) => setConfig({ ...config, customPrompt: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              为此仓库定制审查规则。留空则使用全局默认 Prompt。
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              <span className="text-xs text-muted-foreground">快捷模板：</span>
              {defaultPrompts.map((template) => (
                <Button
                  key={template.name}
                  variant="outline"
                  size="xs"
                  className="h-6 text-xs"
                  onClick={() => setConfig({ ...config, customPrompt: template.prompt })}
                >
                  {template.name}
                </Button>
              ))}
            </div>
          </div>

          {/* 保存按钮 */}
          <div className="flex justify-end pt-4 border-t">
            <Button onClick={saveConfig} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  保存中...
                </>
              ) : (
                '保存配置'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 当前配置预览 */}
      {(repository.defaultAIModel || repository.customPrompt || repository.watchBranches) && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">当前配置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {repository.watchBranches && (
              <div>
                <span className="text-muted-foreground">监听分支：</span>
                <Badge variant="outline" className="ml-2">
                  {repository.watchBranches}
                </Badge>
              </div>
            )}
            {repository.defaultAIModel && (
              <div>
                <span className="text-muted-foreground">AI 模型：</span>
                <Badge variant="outline" className="ml-2">
                  {getModelDisplayName(repository.defaultAIModel)}
                </Badge>
              </div>
            )}
            {repository.customPrompt && (
              <div>
                <span className="text-muted-foreground">自定义 Prompt：</span>
                <p className="mt-1 text-xs bg-muted p-2 rounded max-h-32 overflow-y-auto">
                  {repository.customPrompt}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
