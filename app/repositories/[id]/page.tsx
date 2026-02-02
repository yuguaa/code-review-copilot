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

export default function RepositoryDetailPage() {
  const params = useParams()
  const router = useRouter()
  const repositoryId = params.id as string

  const [repository, setRepository] = useState<Repository | null>(null)
  const [aiModels, setAiModels] = useState<AIModel[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // 配置表单状态
  const [config, setConfig] = useState({
    defaultAIModelId: '',
    customPrompt: '',
    watchBranches: '',
  })

  // 加载仓库数据
  const loadRepository = async () => {
    try {
      const response = await fetch(`/api/repositories/${repositoryId}`)
      if (!response.ok) {
        throw new Error('Repository not found')
      }
      const data = await response.json()
      setRepository(data)
      setConfig({
        defaultAIModelId: data.defaultAIModelId || '',
        customPrompt: data.customPrompt || '',
        watchBranches: data.watchBranches || '',
      })
    } catch (error) {
      toast.error('加载仓库信息失败')
      router.push('/repositories')
    } finally {
      setLoading(false)
    }
  }

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

  useEffect(() => {
    loadRepository()
    loadAIModels()
  }, [repositoryId])

  // 保存配置
  const saveConfig = async () => {
    setSaving(true)
    try {
      const response = await fetch('/api/repositories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: repositoryId,
          defaultAIModelId: config.defaultAIModelId || null,
          customPrompt: config.customPrompt || null,
          watchBranches: config.watchBranches || null,
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

          {/* AI 模型 */}
          <div className="space-y-2">
            <Label>AI 模型</Label>
            <Select
              value={config.defaultAIModelId}
              onValueChange={(value) => setConfig({ ...config, defaultAIModelId: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="使用全局默认模型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">使用全局默认模型</SelectItem>
                {aiModels.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {getModelDisplayName(model)}
                    <span className="text-muted-foreground text-xs ml-2">
                      ({model.provider})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              为此仓库选择专用的 AI 模型。留空则使用全局默认模型。
            </p>
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
