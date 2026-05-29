'use client'

import { useCallback, useState, useEffect, type FormEvent } from 'react'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ArrowDown, ArrowLeft, ArrowUp, Bot, GitFork, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
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
  watchBranches: string | null
  gitLabAccount: {
    id: string
    url: string
  } | null
  _count: {
    reviewLogs: number
  }
}

type MemorySnapshot = {
  id: string
  branch: string
  commitSha: string
  status: string
  architectureSummary: string
  confidence: number
  lastIndexedAt: string
}

type MemoryFact = {
  id: string
  type: string
  content: string
  confidence: number
}

type PromptMode = 'extend' | 'replace'

type ReviewBot = {
  id: string
  name: string
  description: string | null
  aiModelId: string
  aiModel: AIModel | null
  prompt: string | null
  promptMode: PromptMode
  isActive: boolean
  sortOrder: number
  maxIterations: number
  maxContextFiles: number
  maxCallGraphDepth: number
  maxFindings: number
}

type BotFormState = {
  id: string | null
  name: string
  description: string
  aiModelId: string
  prompt: string
  promptMode: PromptMode
  isActive: boolean
  sortOrder: number
  maxIterations: number
  maxContextFiles: number
  maxCallGraphDepth: number
  maxFindings: number
}

const emptyBotForm: BotFormState = {
  id: null,
  name: '',
  description: '',
  aiModelId: '',
  prompt: '',
  promptMode: 'extend',
  isActive: true,
  sortOrder: 0,
  maxIterations: 5,
  maxContextFiles: 12,
  maxCallGraphDepth: 2,
  maxFindings: 50,
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

const sortBots = (bots: ReviewBot[]) => {
  return [...bots].sort((left, right) => left.sortOrder - right.sortOrder)
}

const toErrorMessage = (error: unknown, fallback: string) => {
  return error instanceof Error ? error.message : fallback
}

const toPositiveInteger = (value: unknown, fallback: number) => {
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? Math.max(1, Math.trunc(numberValue)) : fallback
}

const toNonNegativeInteger = (value: unknown, fallback: number) => {
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? Math.max(0, Math.trunc(numberValue)) : fallback
}

export default function RepositoryDetailPage() { // 仓库详情页组件
  const params = useParams() // 读取路由参数
  const router = useRouter() // 获取路由实例
  const repositoryId = Array.isArray(params.id) ? params.id[0] : (params.id as string | undefined) // 兼容数组与空值的路由参数

  const [repository, setRepository] = useState<Repository | null>(null)
  const [aiModels, setAiModels] = useState<AIModel[]>([])
  const [reviewBots, setReviewBots] = useState<ReviewBot[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadingBots, setLoadingBots] = useState(false)
  const [savingBot, setSavingBot] = useState(false)
  const [memorySnapshots, setMemorySnapshots] = useState<MemorySnapshot[]>([])
  const [memoryFacts, setMemoryFacts] = useState<MemoryFact[]>([])
  const [refreshingMemory, setRefreshingMemory] = useState(false)
  const [rebuildingCodeGraph, setRebuildingCodeGraph] = useState(false)
  const [botDialogOpen, setBotDialogOpen] = useState(false)
  const [botForm, setBotForm] = useState<BotFormState>(emptyBotForm)

  // 配置表单状态
  const [config, setConfig] = useState({
    watchBranches: '',
  })

  // 加载仓库数据
  const loadRepository = useCallback(() => { // 加载仓库详情数据
    if (!repositoryId) { // 当缺少仓库 ID
      setLoading(false) // 结束加载态
      toast.error('仓库 ID 无效') // 提示无效 ID
      router.push('/repositories') // 跳回列表页
      return // 终止后续请求
    } // 结束 ID 校验
    return fetch(`/api/repositories/${repositoryId}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error('Repository not found')
        }
        return response.json()
      })
      .then((data: Repository) => {
        setRepository(data)
        setConfig({
          watchBranches: data.watchBranches || '',
        })
      })
      .catch(() => {
        toast.error('加载仓库信息失败')
        router.push('/repositories')
      })
      .finally(() => setLoading(false))
  }, [repositoryId, router]) // 结束 loadRepository

  // 加载 AI 模型
  const loadAIModels = useCallback(() => {
    return fetch('/api/settings/models')
      .then((response) => response.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setAiModels(data.filter((model: AIModel) => model.isActive))
        }
      })
      .catch((error) => {
        console.error('Failed to load AI models:', error)
      })
  }, [])

  const loadReviewBots = useCallback(() => {
    if (!repositoryId) return
    setLoadingBots(true)
    return fetch(`/api/repositories/${repositoryId}/bots`)
      .then((response) => {
        if (!response.ok) {
          throw new Error('加载审查机器人失败')
        }
        return response.json()
      })
      .then((data) => {
        setReviewBots(Array.isArray(data) ? sortBots(data as ReviewBot[]) : [])
      })
      .catch((error) => {
        toast.error(toErrorMessage(error, '加载审查机器人失败'))
      })
      .finally(() => setLoadingBots(false))
  }, [repositoryId])

  const loadMemory = useCallback(() => {
    if (!repositoryId) return
    return fetch(`/api/repositories/${repositoryId}/memory`)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!data) return
        setMemorySnapshots(Array.isArray(data.snapshots) ? data.snapshots : [])
        setMemoryFacts(Array.isArray(data.facts) ? data.facts : [])
      })
      .catch((error) => {
        console.error('Failed to load memory wiki:', error)
      })
  }, [repositoryId])

  useEffect(() => { // 监听仓库 ID 变化
    if (!repositoryId) { // 当仓库 ID 不存在
      return // 直接返回避免请求
    } // 结束 ID 校验
    void Promise.resolve().then(() => {
      loadRepository() // 加载仓库详情
      loadAIModels() // 加载 AI 模型
      loadReviewBots() // 加载审查机器人
      loadMemory() // 加载 Memory Wiki
    })
  }, [loadAIModels, loadMemory, loadRepository, loadReviewBots, repositoryId]) // 依赖仓库 ID

  // 保存配置
  const saveConfig = () => {
    setSaving(true)
    return fetch('/api/repositories', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: repositoryId,
        watchBranches: config.watchBranches || null,
      }),
    })
      .then((response) => {
        if (!response.ok) {
          return response.json().then((error) => {
            throw new Error(error.error || 'Failed to update repository')
          })
        }
        return response.json()
      })
      .then((updated: Repository) => {
        setRepository(updated)
        setConfig({
          watchBranches: updated.watchBranches || '',
        })
        toast.success('仓库配置已保存')
      })
      .catch((error) => {
        toast.error(toErrorMessage(error, '保存失败'))
      })
      .finally(() => setSaving(false))
  }

  const resetBotForm = () => {
    setBotForm({
      ...emptyBotForm,
      aiModelId: aiModels[0]?.id || '',
      sortOrder: reviewBots.length,
    })
  }

  const openCreateBotDialog = () => {
    setBotForm({
      ...emptyBotForm,
      aiModelId: aiModels[0]?.id || '',
      sortOrder: reviewBots.length,
    })
    setBotDialogOpen(true)
  }

  const openEditBotDialog = (bot: ReviewBot) => {
    setBotForm({
      id: bot.id,
      name: bot.name,
      description: bot.description || '',
      aiModelId: bot.aiModelId,
      prompt: bot.prompt || '',
      promptMode: bot.promptMode || 'extend',
      isActive: bot.isActive,
      sortOrder: bot.sortOrder,
      maxIterations: toPositiveInteger(bot.maxIterations, 5),
      maxContextFiles: toPositiveInteger(bot.maxContextFiles, 12),
      maxCallGraphDepth: toNonNegativeInteger(bot.maxCallGraphDepth, 2),
      maxFindings: toPositiveInteger(bot.maxFindings, 50),
    })
    setBotDialogOpen(true)
  }

  const saveBot = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!botForm.name.trim()) {
      toast.error('请填写机器人名称')
      return
    }

    if (!botForm.aiModelId) {
      toast.error('请选择机器人使用的 AI 模型')
      return
    }

    setSavingBot(true)

    return fetch(`/api/repositories/${repositoryId}/bots`, {
      method: botForm.id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(botForm.id ? { id: botForm.id } : {}),
        name: botForm.name.trim(),
        description: botForm.description.trim() || null,
        aiModelId: botForm.aiModelId,
        prompt: botForm.prompt.trim() || null,
        promptMode: botForm.promptMode,
        isActive: botForm.isActive,
        sortOrder: botForm.sortOrder,
        maxIterations: botForm.maxIterations,
        maxContextFiles: botForm.maxContextFiles,
        maxCallGraphDepth: botForm.maxCallGraphDepth,
        maxFindings: botForm.maxFindings,
      }),
    })
      .then((response) => {
        if (!response.ok) {
          return response.json().then((error) => {
            throw new Error(error.error || '保存审查机器人失败')
          })
        }
        return response.json()
      })
      .then((savedBot: ReviewBot) => {
        setReviewBots((currentBots) => {
          const nextBots = botForm.id
            ? currentBots.map((bot) => bot.id === savedBot.id ? savedBot : bot)
            : [...currentBots, savedBot]
          return sortBots(nextBots)
        })
        setBotDialogOpen(false)
        resetBotForm()
        toast.success(botForm.id ? '审查机器人已更新' : '审查机器人已创建')
      })
      .catch((error) => {
        toast.error(toErrorMessage(error, '保存审查机器人失败'))
      })
      .finally(() => setSavingBot(false))
  }

  const updateBot = (bot: ReviewBot, changes: Partial<ReviewBot>) => {
    return fetch(`/api/repositories/${repositoryId}/bots`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: bot.id,
          ...changes,
        }),
      })
      .then((response) => {
        if (!response.ok) {
          return response.json().then((error) => {
            throw new Error(error.error || '更新审查机器人失败')
          })
        }
        return response.json()
      })
      .then((updatedBot: ReviewBot) => {
        setReviewBots((currentBots) => sortBots(currentBots.map((item) => item.id === updatedBot.id ? updatedBot : item)))
        return updatedBot
      })
  }

  // 切换自动审查
  const toggleAutoReview = () => {
    if (!repository) return

    return fetch('/api/repositories', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: repository.id,
        autoReview: !repository.autoReview,
      }),
    })
      .then((response) => {
        if (!response.ok) throw new Error('Failed to update repository')
        return response.json()
      })
      .then((updated: Repository) => {
        setRepository(updated)
        toast.success(`自动审查已${updated.autoReview ? '启用' : '禁用'}`)
      })
      .catch(() => {
        toast.error('更新失败')
      })
  }

  const toggleBotActive = (bot: ReviewBot) => {
    return updateBot(bot, { isActive: !bot.isActive })
      .then((updatedBot) => {
        toast.success(`${updatedBot.name} 已${updatedBot.isActive ? '启用' : '禁用'}`)
      })
      .catch((error) => {
        toast.error(toErrorMessage(error, '更新审查机器人失败'))
      })
  }

  const deleteBot = (bot: ReviewBot) => {
    return fetch(`/api/repositories/${repositoryId}/bots?id=${encodeURIComponent(bot.id)}`, {
      method: 'DELETE',
    })
      .then((response) => {
        if (!response.ok) {
          return response.json().then((error) => {
            throw new Error(error.error || '删除审查机器人失败')
          })
        }
        return response.json()
      })
      .then(() => {
        setReviewBots((currentBots) => currentBots.filter((item) => item.id !== bot.id))
        toast.success('审查机器人已删除')
      })
      .catch((error) => {
        toast.error(toErrorMessage(error, '删除审查机器人失败'))
      })
  }

  const moveBot = (bot: ReviewBot, direction: 'up' | 'down') => {
    const orderedBots = sortBots(reviewBots)
    const currentIndex = orderedBots.findIndex((item) => item.id === bot.id)
    const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    const targetBot = orderedBots[nextIndex]

    if (currentIndex < 0 || !targetBot) return

    return Promise.all([
      updateBot(bot, { sortOrder: nextIndex }),
      updateBot(targetBot, { sortOrder: currentIndex }),
    ])
      .then(() => {
        setReviewBots((currentBots) => sortBots(currentBots.map((item) => {
          if (item.id === bot.id) return { ...item, sortOrder: nextIndex }
          if (item.id === targetBot.id) return { ...item, sortOrder: currentIndex }
          return item
        })))
      })
      .catch((error) => {
        toast.error(toErrorMessage(error, '调整排序失败'))
        loadReviewBots()
      })
  }

  const refreshMemory = () => {
    if (!repositoryId) return
    setRefreshingMemory(true)
    return fetch(`/api/repositories/${repositoryId}/memory/refresh`, {
      method: 'POST',
    })
      .then((response) => {
        if (!response.ok) {
          return response.json().then((error) => {
            throw new Error(error.error || '刷新 Memory Wiki 失败')
          })
        }
        return loadMemory()
      })
      .then(() => {
        toast.success('Memory Wiki 已刷新')
      })
      .catch((error) => {
        toast.error(toErrorMessage(error, '刷新 Memory Wiki 失败'))
      })
      .finally(() => setRefreshingMemory(false))
  }

  const rebuildCodeGraph = () => {
    if (!repositoryId) return
    setRebuildingCodeGraph(true)
    return fetch(`/api/repositories/${repositoryId}/memory/refresh?force=true`, {
      method: 'POST',
    })
      .then((response) => {
        if (!response.ok) {
          return response.json().then((error) => {
            throw new Error(error.error || '重建 Code Graph 失败')
          })
        }
        return loadMemory()
      })
      .then(() => {
        toast.success('Code Graph 已全量重建')
      })
      .catch((error) => {
        toast.error(toErrorMessage(error, '重建 Code Graph 失败'))
      })
      .finally(() => setRebuildingCodeGraph(false))
  }

  // 默认系统 Prompt 模板
  const defaultPrompts = [
    {
      name: '全面审查',
      prompt: '请全面审查此代码，重点关注安全、正确性、可维护性、性能和测试风险。请输出可定位、可行动的问题。',
    },
    {
      name: '安全优先',
      prompt: '请重点关注权限、输入校验、敏感数据、注入、鉴权绕过和依赖安全风险。低置信问题也可以保留，但必须标注原因。',
    },
    {
      name: '性能优先',
      prompt: '请重点关注 N+1 查询、重复 IO、缓存失效、算法复杂度、渲染性能和资源泄漏风险。',
    },
    {
      name: '架构守护',
      prompt: '请重点关注跨文件调用链、模块边界、职责泄漏、抽象倒置和与 Memory Wiki 中项目架构约定冲突的问题。',
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

  const orderedReviewBots = sortBots(reviewBots)
  const activeReviewBotCount = orderedReviewBots.filter((bot) => bot.isActive).length

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
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Memory Wiki</CardTitle>
              <CardDescription>
                Agent 审查时会读取这里的项目架构记忆和调用链上下文。
              </CardDescription>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                onClick={refreshMemory}
                disabled={refreshingMemory || rebuildingCodeGraph}
              >
                {refreshingMemory ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    刷新中...
                  </>
                ) : (
                  '增量刷新 Memory'
                )}
              </Button>
              <Button
                variant="secondary"
                onClick={rebuildCodeGraph}
                disabled={refreshingMemory || rebuildingCodeGraph}
              >
                {rebuildingCodeGraph ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    重建中...
                  </>
                ) : (
                  '重建 Code Graph'
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {memorySnapshots[0] ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">分支：{memorySnapshots[0].branch}</Badge>
                <Badge variant="outline">状态：{memorySnapshots[0].status}</Badge>
                <Badge variant="outline">图缓存：{memorySnapshots[0].commitSha === '__branch_code_graph__' ? '分支级' : memorySnapshots[0].commitSha.slice(0, 8)}</Badge>
                <Badge variant="outline">置信度：{memorySnapshots[0].confidence.toFixed(2)}</Badge>
              </div>
              <div className="rounded-md bg-muted p-3 text-sm whitespace-pre-wrap">
                {memorySnapshots[0].architectureSummary}
              </div>
              {memoryFacts.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">高置信记忆</p>
                  <div className="space-y-2">
                    {memoryFacts.slice(0, 5).map((fact) => (
                      <div key={fact.id} className="rounded-md border p-2 text-xs">
                        <Badge variant="secondary" className="mr-2">{fact.type}</Badge>
                        <span>{fact.content}</span>
                        <span className="ml-2 text-muted-foreground">({fact.confidence.toFixed(2)})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              暂无 Memory Wiki。点击“重建 Code Graph”后，Agent 会先建立目标分支的项目级结构图。
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>仓库配置</CardTitle>
          <CardDescription>
            这里仅保留仓库级触发配置。审查运行配置已迁移到下方“审查机器人”。
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

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-3">
                <Bot className="h-5 w-5" />
                审查机器人
              </CardTitle>
              <CardDescription>
                每个启用机器人会在同一次 ReviewLog 下并发执行，最终合并为一条 GitLab 总评。
              </CardDescription>
            </div>
            <Button onClick={openCreateBotDialog} disabled={aiModels.length === 0}>
              <Plus className="h-4 w-4 mr-2" />
              新增机器人
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">总数：{orderedReviewBots.length}</Badge>
            <Badge variant={activeReviewBotCount > 0 ? 'default' : 'secondary'}>
              启用：{activeReviewBotCount}
            </Badge>
            <Badge variant="outline">可用模型：{aiModels.length}</Badge>
          </div>

          {aiModels.length === 0 && (
            <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
              暂无可用 AIModel。请先在系统设置中启用模型，机器人只引用已有模型，不单独保存 API Key。
            </div>
          )}

          {loadingBots ? (
            <div className="flex items-center justify-center rounded-md border p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              正在加载审查机器人...
            </div>
          ) : orderedReviewBots.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center">
              <p className="text-sm font-medium">还没有审查机器人</p>
              <p className="mt-1 text-sm text-muted-foreground">
                新增至少一个启用机器人后，手动审查、Webhook 和 Retry 才会进入并发审查流程。
              </p>
              <Button className="mt-4" variant="outline" onClick={openCreateBotDialog} disabled={aiModels.length === 0}>
                <Plus className="h-4 w-4 mr-2" />
                创建第一个机器人
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {orderedReviewBots.map((bot, index) => (
                <div key={bot.id} className="rounded-lg border bg-card p-4">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{bot.name}</p>
                        <Badge variant={bot.isActive ? 'default' : 'secondary'}>
                          {bot.isActive ? '启用' : '停用'}
                        </Badge>
                        <Badge variant="outline">
                          {bot.aiModel ? getModelDisplayName(bot.aiModel) : '模型缺失'}
                        </Badge>
                        <Badge variant="outline">
                          {bot.promptMode === 'replace' ? '替换 Prompt' : '扩展 Prompt'}
                        </Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <Badge variant="secondary">轮次 {bot.maxIterations}</Badge>
                        <Badge variant="secondary">上下文文件 {bot.maxContextFiles}</Badge>
                        <Badge variant="secondary">调用深度 {bot.maxCallGraphDepth}</Badge>
                        <Badge variant="secondary">Findings {bot.maxFindings}</Badge>
                      </div>
                      {bot.description && (
                        <p className="mt-2 text-sm text-muted-foreground">{bot.description}</p>
                      )}
                      {bot.prompt ? (
                        <p className="mt-3 max-h-24 overflow-y-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
                          {bot.prompt}
                        </p>
                      ) : (
                        <p className="mt-3 text-xs text-muted-foreground">
                          未配置专属 Prompt，将仅使用审查内置 Prompt。
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 md:justify-end">
                      <Button
                        variant="outline"
                        size="icon-xs"
                        onClick={() => moveBot(bot, 'up')}
                        disabled={index === 0}
                        title="上移"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-xs"
                        onClick={() => moveBot(bot, 'down')}
                        disabled={index === orderedReviewBots.length - 1}
                        title="下移"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => toggleBotActive(bot)}>
                        {bot.isActive ? '停用' : '启用'}
                      </Button>
                      <Button variant="outline" size="icon-sm" onClick={() => openEditBotDialog(bot)} title="编辑">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="icon-sm" onClick={() => deleteBot(bot)} title="删除">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={botDialogOpen} onOpenChange={(open) => {
        setBotDialogOpen(open)
        if (!open) resetBotForm()
      }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <form onSubmit={saveBot} className="space-y-5">
            <DialogHeader>
              <DialogTitle>{botForm.id ? '编辑审查机器人' : '新增审查机器人'}</DialogTitle>
              <DialogDescription>
                机器人会使用自己的模型和 Prompt 独立执行 Agent Loop，评论中会标注来源。
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="bot-name">机器人名称</Label>
                <Input
                  id="bot-name"
                  value={botForm.name}
                  placeholder="例如：安全审查机器人"
                  onChange={(event) => setBotForm({ ...botForm, name: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>AI 模型</Label>
                <Select
                  value={botForm.aiModelId}
                  onValueChange={(value) => setBotForm({ ...botForm, aiModelId: value })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择 AI 模型" />
                  </SelectTrigger>
                  <SelectContent>
                    {aiModels.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {getModelDisplayName(model)} ({model.provider})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bot-description">描述</Label>
              <Input
                id="bot-description"
                value={botForm.description}
                placeholder="说明这个机器人关注的审查方向"
                onChange={(event) => setBotForm({ ...botForm, description: event.target.value })}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Prompt 模式</Label>
                <Select
                  value={botForm.promptMode}
                  onValueChange={(value: PromptMode) => setBotForm({ ...botForm, promptMode: value })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="extend">扩展内置 Prompt</SelectItem>
                    <SelectItem value="replace">替换内置 Prompt</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  扩展模式适合补充关注点；替换模式适合完全定制审查策略。
                </p>
              </div>
              <div className="space-y-2">
                <Label>启停状态</Label>
                <Select
                  value={botForm.isActive ? 'active' : 'inactive'}
                  onValueChange={(value) => setBotForm({ ...botForm, isActive: value === 'active' })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">启用</SelectItem>
                    <SelectItem value="inactive">停用</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  只有启用机器人会参与下一次并发审查。
                </p>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="mb-4">
                <p className="text-sm font-medium">Agent Loop 预算</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  控制单次审查读取多少上下文。大仓库建议只给少数深扫机器人调高预算。
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-4">
                <div className="space-y-2">
                  <Label htmlFor="bot-max-iterations">最大轮次</Label>
                  <Input
                    id="bot-max-iterations"
                    type="number"
                    min={1}
                    max={10}
                    value={botForm.maxIterations}
                    onChange={(event) => setBotForm({
                      ...botForm,
                      maxIterations: toPositiveInteger(event.target.value, 5),
                    })}
                  />
                  <p className="text-xs text-muted-foreground">1-10，默认 5。</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bot-max-context-files">上下文文件</Label>
                  <Input
                    id="bot-max-context-files"
                    type="number"
                    min={1}
                    max={200}
                    value={botForm.maxContextFiles}
                    onChange={(event) => setBotForm({
                      ...botForm,
                      maxContextFiles: toPositiveInteger(event.target.value, 12),
                    })}
                  />
                  <p className="text-xs text-muted-foreground">1-200，默认 12。</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bot-max-call-graph-depth">调用深度</Label>
                  <Input
                    id="bot-max-call-graph-depth"
                    type="number"
                    min={0}
                    max={4}
                    value={botForm.maxCallGraphDepth}
                    onChange={(event) => setBotForm({
                      ...botForm,
                      maxCallGraphDepth: toNonNegativeInteger(event.target.value, 2),
                    })}
                  />
                  <p className="text-xs text-muted-foreground">0-4，默认 2。</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bot-max-findings">最大 Findings</Label>
                  <Input
                    id="bot-max-findings"
                    type="number"
                    min={1}
                    max={200}
                    value={botForm.maxFindings}
                    onChange={(event) => setBotForm({
                      ...botForm,
                      maxFindings: toPositiveInteger(event.target.value, 50),
                    })}
                  />
                  <p className="text-xs text-muted-foreground">1-200，默认 50。</p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bot-prompt">机器人 Prompt</Label>
              <Textarea
                id="bot-prompt"
                rows={8}
                value={botForm.prompt}
                placeholder="输入这个机器人的专属审查提示词，留空则使用内置 Prompt..."
                onChange={(event) => setBotForm({ ...botForm, prompt: event.target.value })}
              />
              <div className="flex flex-wrap gap-2">
                <span className="text-xs text-muted-foreground">快捷模板：</span>
                {defaultPrompts.map((template) => (
                  <Button
                    key={template.name}
                    type="button"
                    variant="outline"
                    size="xs"
                    className="h-6 text-xs"
                    onClick={() => setBotForm({ ...botForm, prompt: template.prompt })}
                  >
                    {template.name}
                  </Button>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setBotDialogOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={savingBot}>
                {savingBot ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    保存中...
                  </>
                ) : (
                  '保存机器人'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
