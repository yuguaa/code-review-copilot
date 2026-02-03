'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Loader2, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

type GitLabAccount = {
  id: string
  url: string
  accessToken: string
  webhookSecret: string | null
  isActive: boolean
  createdAt: string
  _count: {
    repositories: number
  }
}

type AIModel = {
  id: string
  provider: 'openai' | 'claude' | 'custom'
  modelId: string
  apiKey: string
  apiEndpoint: string | null
  maxTokens: number | null
  temperature: number | null
  isActive: boolean
  createdAt: string
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

export default function SettingsPage() {
  const [gitlabAccount, setGitLabAccount] = useState<GitLabAccount | null>(null)
  const [aiModels, setAiModels] = useState<AIModel[]>([])
  const [loading, setLoading] = useState(true)

  // 分离的 loading 状态
  const [gitlabTesting, setGitlabTesting] = useState(false)
  const [gitlabFormTesting, setGitlabFormTesting] = useState(false)
  const [gitlabSaving, setGitlabSaving] = useState(false)
  const [aiModelTesting, setAiModelTesting] = useState(false)
  const [aiModelSaving, setAiModelSaving] = useState(false)

  // AI 模型表单状态
  const [editingModel, setEditingModel] = useState<AIModel | null>(null)
  const [modelForm, setModelForm] = useState({
    provider: 'openai' as 'openai' | 'claude' | 'custom',
    modelId: '',
    apiKey: '',
    apiEndpoint: '',
    maxTokens: '',
    temperature: '',
  })

  // GitLab 账号表单状态
  const [gitlabForm, setGitlabForm] = useState({
    url: '',
    accessToken: '',
    webhookSecret: '',
  })

  // 加载数据
  useEffect(() => {
    Promise.all([
      fetch('/api/settings/gitlab/account').then(r => r.json()),
      fetch('/api/settings/models').then(r => r.json()),
    ]).then(([account, models]) => {
      setGitLabAccount(account)
      setAiModels(models)
      setLoading(false)
    })
  }, [])

  // 更新 GitLab 账号
  const updateGitLabAccount = async () => {
    if (!gitlabAccount) return

    const response = await fetch('/api/settings/gitlab/account', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: gitlabAccount.id,
        isActive: !gitlabAccount.isActive,
      }),
    })

    if (!response.ok) throw new Error('Failed to update account')

    await response.json()
    setGitLabAccount({ ...gitlabAccount, isActive: !gitlabAccount.isActive })
    toast.success(`GitLab 账号 ${gitlabAccount.isActive ? '已禁用' : '已启用'}`)
  }

  // 测试 GitLab 连接
  const testConnection = async () => {
    if (!gitlabAccount) return

    setGitlabTesting(true)
    try {
      const response = await fetch('/api/settings/gitlab/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: gitlabAccount.url,
          accessToken: gitlabAccount.accessToken,
        }),
      })
      if (!response.ok) throw new Error('Connection test failed')

      const result = await response.json()
      if (result.success) {
        toast.success('可以正常访问 GitLab')
      } else {
        throw new Error('连接失败')
      }
    } catch (error) {
      toast.error('请检查 URL 和访问令牌是否正确')
    } finally {
      setGitlabTesting(false)
    }
  }

  // 测试表单中的 GitLab 连接
  const testFormConnection = async () => {
    if (!gitlabForm.url || !gitlabForm.accessToken) {
      toast.error('URL 和访问令牌为必填项')
      return
    }

    setGitlabFormTesting(true)
    try {
      const response = await fetch('/api/settings/gitlab/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: gitlabForm.url,
          accessToken: gitlabForm.accessToken,
        }),
      })
      if (!response.ok) throw new Error('Connection test failed')

      const result = await response.json()
      if (result.success) {
        toast.success('可以正常访问 GitLab')
      } else {
        throw new Error('连接失败')
      }
    } catch (error) {
      toast.error('请检查 URL 和访问令牌是否正确')
    } finally {
      setGitlabFormTesting(false)
    }
  }

  // 保存 GitLab 账号
  const saveGitLabAccount = async () => {
    if (!gitlabForm.url || !gitlabForm.accessToken) {
      toast.error('URL 和访问令牌为必填项')
      return
    }

    setGitlabSaving(true)
    try {
      const response = await fetch('/api/settings/gitlab/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: gitlabForm.url,
          accessToken: gitlabForm.accessToken,
          webhookSecret: gitlabForm.webhookSecret || null,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to save account')
      }

      const savedAccount = await response.json()
      setGitLabAccount(savedAccount)
      resetGitLabForm()
      toast.success('GitLab 账号已添加')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '未知错误')
    } finally {
      setGitlabSaving(false)
    }
  }

  // 保存 AI 模型
  const saveAIModel = async () => {
    if (!modelForm.modelId || !modelForm.apiKey) {
      toast.error('模型 ID 和 API 密钥为必填项')
      return
    }

    // 自定义模型需要配置请求地址
    if (modelForm.provider === 'custom' && !modelForm.apiEndpoint) {
      toast.error('自定义模型需要配置 API 请求地址')
      return
    }

    setAiModelSaving(true)
    try {
      const url = '/api/settings/models'
      const method = editingModel ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(editingModel ? { id: editingModel.id } : {}),
          provider: modelForm.provider,
          modelId: modelForm.modelId,
          apiKey: modelForm.apiKey,
          apiEndpoint: modelForm.apiEndpoint || null,
          maxTokens: modelForm.maxTokens ? parseInt(modelForm.maxTokens) : null,
          temperature: modelForm.temperature ? parseFloat(modelForm.temperature) : null,
        }),
      })
      if (!response.ok) throw new Error('Failed to save model')

      const savedModel = await response.json()

      if (editingModel) {
        setAiModels(aiModels.map(m => m.id === editingModel.id ? savedModel : m))
        toast.success('AI 模型已更新')
      } else {
        setAiModels([...aiModels, savedModel])
        toast.success('AI 模型已添加')
      }

      setEditingModel(null)
      resetModelForm()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '未知错误')
    } finally {
      setAiModelSaving(false)
    }
  }

  // 编辑 AI 模型
  const editModel = (model: AIModel) => {
    setEditingModel(model)
    setModelForm({
      provider: model.provider,
      modelId: model.modelId,
      apiKey: model.apiKey,
      apiEndpoint: model.apiEndpoint || '',
      maxTokens: model.maxTokens?.toString() || '',
      temperature: model.temperature?.toString() || '',
    })
  }

  // 取消编辑
  const cancelEditModel = () => {
    setEditingModel(null)
    resetModelForm()
  }

  // 删除 AI 模型
  const deleteAIModel = async (id: string) => {
    try {
      const response = await fetch(`/api/settings/models?id=${id}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error('Failed to delete model')

      setAiModels(aiModels.filter(m => m.id !== id))
      toast.success('AI 模型已删除')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '未知错误')
    }
  }

  // 切换激活状态
  const toggleModelActive = async (model: AIModel) => {
    try {
      const response = await fetch('/api/settings/models', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: model.id,
          isActive: !model.isActive,
        }),
      })
      if (!response.ok) throw new Error('Failed to update model')

      setAiModels(aiModels.map(m => m.id === model.id ? { ...m, isActive: !m.isActive } : m))
      toast.success(`模型 ${getModelDisplayName(model)} ${model.isActive ? '已禁用' : '已启用'}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '未知错误')
    }
  }

  // 测试 AI 模型连接
  const testAIModelConnection = async (model?: AIModel) => {
    const provider = model?.provider || modelForm.provider
    const modelId = model?.modelId || modelForm.modelId
    const apiKey = model?.apiKey || modelForm.apiKey
    const apiEndpoint = model?.apiEndpoint || modelForm.apiEndpoint

    if (!provider || !modelId || !apiKey) {
      toast.error('提供商、模型 ID 和 API 密钥为必填项')
      return
    }

    if (provider === 'custom' && !apiEndpoint) {
      toast.error('自定义模型需要配置 API 请求地址')
      return
    }

    setAiModelTesting(true)
    try {
      const response = await fetch('/api/settings/models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          modelId,
          apiKey,
          apiEndpoint: apiEndpoint || null,
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
      setAiModelTesting(false)
    }
  }

  const resetModelForm = () => {
    setModelForm({
      provider: 'openai',
      modelId: '',
      apiKey: '',
      apiEndpoint: '',
      maxTokens: '',
      temperature: '',
    })
  }

  const resetGitLabForm = () => {
    setGitlabForm({
      url: '',
      accessToken: '',
      webhookSecret: '',
    })
  }

  // 获取常用模型 ID 建议
  const getModelSuggestions = () => {
    switch (modelForm.provider) {
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

  return (
    <div className="p-8">
      {/* 页面标题 */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">配置</h1>
        <p className="text-muted-foreground">
          管理 GitLab 账号和全局 AI 模型配置
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="space-y-8">
          {/* GitLab 账号配置 */}
          <Card>
            <CardHeader>
              <CardTitle>GitLab 账号</CardTitle>
              <CardDescription>
                配置您的 GitLab 实例信息以连接仓库
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {!gitlabAccount ? (
                <>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>GitLab URL</Label>
                      <Input
                        placeholder="https://gitlab.com"
                        value={gitlabForm.url}
                        onChange={(e) => setGitlabForm({ ...gitlabForm, url: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>访问令牌 (Access Token)</Label>
                      <Input
                        type="password"
                        placeholder="glpat-..."
                        value={gitlabForm.accessToken}
                        onChange={(e) => setGitlabForm({ ...gitlabForm, accessToken: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        在 GitLab 中创建个人访问令牌，需要 api 和 read_repository 权限
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label>Webhook 密钥（可选）</Label>
                      <Input
                        type="password"
                        placeholder="用于验证 Webhook 请求的密钥"
                        value={gitlabForm.webhookSecret}
                        onChange={(e) => setGitlabForm({ ...gitlabForm, webhookSecret: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={testFormConnection} disabled={gitlabFormTesting || gitlabSaving}>
                      {gitlabFormTesting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      测试连接
                    </Button>
                    <Button onClick={saveGitLabAccount} disabled={gitlabFormTesting || gitlabSaving}>
                      {gitlabSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      保存
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <Badge variant={gitlabAccount.isActive ? 'default' : 'secondary'}>
                        {gitlabAccount.isActive ? '已启用' : '已禁用'}
                      </Badge>
                      <p className="text-sm text-muted-foreground break-all">{gitlabAccount.url}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={testConnection} disabled={gitlabTesting}>
                        {gitlabTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : '测试连接'}
                      </Button>
                      <Button onClick={updateGitLabAccount}>
                        {gitlabAccount.isActive ? '禁用' : '启用'}
                      </Button>
                    </div>
                    <div className="p-4 bg-muted rounded-lg">
                      <p className="text-sm font-medium mb-2">API 访问令</p>
                      <div className="flex items-center gap-2">
                        <code className="text-xs bg-muted px-2 py-1 rounded">
                          {gitlabAccount.accessToken.substring(0, 8)}••••
                        </code>
                        <span className="text-xs text-muted-foreground">
                          {gitlabAccount.accessToken.length} 位
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-6 text-sm text-muted-foreground">
                      <div>已添加仓库: <span className="font-semibold text-foreground">{gitlabAccount._count.repositories}</span></div>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* 全局 AI 模型配置 */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>全局 AI 模型</CardTitle>
                <CardDescription>
                  配置用于代码审查的默认 AI 模型（仓库可单独配置）
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* 添加/编辑模型表单 */}
              {editingModel ? (
                <div className="p-6 border rounded-lg space-y-4">
                  <h3 className="text-lg font-semibold">
                    {editingModel ? '编辑 AI 模型' : '添加 AI 模型'}
                  </h3>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>提供商</Label>
                      <Select
                        value={modelForm.provider}
                        onValueChange={(value) => setModelForm({ ...modelForm, provider: value as any })}
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
                        placeholder={modelForm.provider === 'openai' ? '例如: gpt-4o, gpt-4-turbo' : modelForm.provider === 'claude' ? '例如: claude-3-5-sonnet-20241022' : '例如: llama-3-70b-instruct'}
                        value={modelForm.modelId}
                        onChange={(e) => setModelForm({ ...modelForm, modelId: e.target.value })}
                      />
                      {modelForm.provider !== 'custom' && (
                        <p className="text-xs text-muted-foreground">
                          也可以从常用模型中选择：
                          {getModelSuggestions().map((suggestion) => (
                            <button
                              key={suggestion.value}
                              type="button"
                              className="text-xs text-sidebar-primary hover:underline ml-2"
                              onClick={() => setModelForm({ ...modelForm, modelId: suggestion.value })}
                            >
                              {suggestion.label}
                            </button>
                          ))}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>API 密钥</Label>
                    <Input
                      type="password"
                      placeholder="sk-..."
                      value={modelForm.apiKey}
                      onChange={(e) => setModelForm({ ...modelForm, apiKey: e.target.value })}
                    />
                  </div>
                  {modelForm.provider === 'custom' && (
                    <div className="space-y-2">
                      <Label>API 请求地址</Label>
                      <Input
                        placeholder="https://api.example.com/v1"
                        value={modelForm.apiEndpoint}
                        onChange={(e) => setModelForm({ ...modelForm, apiEndpoint: e.target.value })}
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
                        value={modelForm.maxTokens}
                        onChange={(e) => setModelForm({ ...modelForm, maxTokens: e.target.value })}
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
                        value={modelForm.temperature}
                        onChange={(e) => setModelForm({ ...modelForm, temperature: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={cancelEditModel}
                      disabled={aiModelTesting || aiModelSaving}
                    >
                      取消
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => testAIModelConnection(editingModel || undefined)}
                      disabled={aiModelTesting || aiModelSaving}
                    >
                      {aiModelTesting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : '测试连接'}
                    </Button>
                    <Button onClick={saveAIModel} disabled={aiModelTesting || aiModelSaving}>
                      {aiModelSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : '保存'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="p-6 border rounded-lg space-y-4">
                  <h3 className="text-lg font-semibold">添加 AI 模型</h3>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>提供商</Label>
                      <Select
                        value={modelForm.provider}
                        onValueChange={(value) => setModelForm({ ...modelForm, provider: value as any })}
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
                        placeholder={modelForm.provider === 'openai' ? '例如: gpt-4o, gpt-4-turbo' : modelForm.provider === 'claude' ? '例如: claude-3-5-sonnet-20241022' : '例如: llama-3-70b-instruct'}
                        value={modelForm.modelId}
                        onChange={(e) => setModelForm({ ...modelForm, modelId: e.target.value })}
                      />
                      {modelForm.provider !== 'custom' && (
                        <p className="text-xs text-muted-foreground">
                          也可以从常用模型中选择：
                          {getModelSuggestions().map((suggestion) => (
                            <button
                              key={suggestion.value}
                              type="button"
                              className="text-xs text-sidebar-primary hover:underline ml-2"
                              onClick={() => setModelForm({ ...modelForm, modelId: suggestion.value })}
                            >
                              {suggestion.label}
                            </button>
                          ))}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>API 密钥</Label>
                    <Input
                      type="password"
                      placeholder="sk-..."
                      value={modelForm.apiKey}
                      onChange={(e) => setModelForm({ ...modelForm, apiKey: e.target.value })}
                    />
                  </div>
                  {modelForm.provider === 'custom' && (
                    <div className="space-y-2">
                      <Label>API 请求地址</Label>
                      <Input
                        placeholder="https://api.example.com/v1"
                        value={modelForm.apiEndpoint}
                        onChange={(e) => setModelForm({ ...modelForm, apiEndpoint: e.target.value })}
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
                        value={modelForm.maxTokens}
                        onChange={(e) => setModelForm({ ...modelForm, maxTokens: e.target.value })}
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
                        value={modelForm.temperature}
                        onChange={(e) => setModelForm({ ...modelForm, temperature: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => testAIModelConnection()}
                      disabled={aiModelTesting || aiModelSaving}
                    >
                      {aiModelTesting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : '测试连接'}
                    </Button>
                    <Button onClick={saveAIModel} disabled={aiModelTesting || aiModelSaving}>
                      {aiModelSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : '添加模型'}
                    </Button>
                  </div>
                </div>
              )}

              {/* 模型列表 */}
              <div className="space-y-2">
                {aiModels.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">
                    还没有添加任何 AI 模型
                  </div>
                ) : (
                  aiModels.map((model) => (
                    <div key={model.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold">{getModelDisplayName(model)}</h3>
                          <Badge variant={model.isActive ? 'default' : 'secondary'} className="text-xs">
                            {model.isActive ? '活跃' : '未激活'}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline" className="text-xs">{model.provider}</Badge>
                          <span>•</span>
                          <span className="font-mono">{model.modelId}</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => testAIModelConnection(model)} disabled={aiModelTesting}>
                          {aiModelTesting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : '测试'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => editModel(model)}>
                          <Pencil className="h-3 w-3 mr-1" />
                          编辑
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => toggleModelActive(model)}>
                          {model.isActive ? '禁用' : '启用'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteAIModel(model.id)}>
                          <Trash2 className="h-3 w-3 mr-1" />
                          删除
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
