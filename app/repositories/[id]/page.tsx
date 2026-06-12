'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowDown, ArrowLeft, ArrowUp, GitFork, Loader2, Pencil, Plus, Settings2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

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

type PromptMode = 'extend' | 'replace'

type PiProfile = {
  id: string
  name: string
  description: string | null
  aiModelId: string
  aiModel: AIModel | null
  prompt: string | null
  promptMode: PromptMode
  isActive: boolean
  sortOrder: number
  maxFindings: number
}

type PiProfileFormState = {
  id: string | null
  name: string
  description: string
  aiModelId: string
  prompt: string
  promptMode: PromptMode
  isActive: boolean
  sortOrder: number
  maxFindings: number
}

const emptyPiProfileForm: PiProfileFormState = {
  id: null,
  name: '',
  description: '',
  aiModelId: '',
  prompt: '',
  promptMode: 'extend',
  isActive: true,
  sortOrder: 0,
  maxFindings: 50,
}

const defaultProfilePrompts = [
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
    prompt: '请重点关注跨文件调用链、模块边界、职责泄漏、抽象倒置和与 Code Graph 中项目架构约定冲突的问题。',
  },
]

const commonBranches = [
  { name: '所有分支', value: '*' },
  { name: '主分支', value: 'main,master' },
  { name: '开发分支', value: 'develop,dev' },
  { name: '功能分支', value: 'feature/*' },
  { name: '修复分支', value: 'hotfix/*,bugfix/*' },
  { name: '发布分支', value: 'release/*' },
]

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

const sortPiProfiles = (profiles: PiProfile[]) => {
  return [...profiles].sort((left, right) => left.sortOrder - right.sortOrder)
}

const toErrorMessage = (error: unknown, fallback: string) => {
  return error instanceof Error ? error.message : fallback
}

const toPositiveInteger = (value: unknown, fallback: number) => {
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? Math.max(1, Math.trunc(numberValue)) : fallback
}

export default function RepositoryDetailPage() {
  const params = useParams()
  const router = useRouter()
  const repositoryId = Array.isArray(params.id) ? params.id[0] : (params.id as string | undefined)

  const [repository, setRepository] = useState<Repository | null>(null)
  const [aiModels, setAiModels] = useState<AIModel[]>([])
  const [piProfiles, setPiProfiles] = useState<PiProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadingPiProfiles, setLoadingPiProfiles] = useState(false)
  const [savingPiProfile, setSavingPiProfile] = useState(false)
  const [piProfileDialogOpen, setPiProfileDialogOpen] = useState(false)
  const [piProfileForm, setPiProfileForm] = useState<PiProfileFormState>(emptyPiProfileForm)
  const [config, setConfig] = useState({ watchBranches: '' })

  const piProfilesUrl = repositoryId ? `/api/repositories/${repositoryId}/pi-profiles` : ''

  const loadRepository = useCallback(() => {
    if (!repositoryId) {
      setLoading(false)
      toast.error('仓库 ID 无效')
      router.push('/repositories')
      return Promise.resolve()
    }

    return fetch(`/api/repositories/${repositoryId}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error('Repository not found')
        }
        return response.json()
      })
      .then((data: Repository) => {
        setRepository(data)
        setConfig({ watchBranches: data.watchBranches || '' })
      })
      .catch(() => {
        toast.error('加载仓库信息失败')
        router.push('/repositories')
      })
      .finally(() => setLoading(false))
  }, [repositoryId, router])

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

  const loadPiProfiles = useCallback(() => {
    if (!piProfilesUrl) return Promise.resolve()

    setLoadingPiProfiles(true)
    return fetch(piProfilesUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error('加载 Pi Profile 失败')
        }
        return response.json()
      })
      .then((data) => {
        setPiProfiles(Array.isArray(data) ? sortPiProfiles(data as PiProfile[]) : [])
      })
      .catch((error) => {
        toast.error(toErrorMessage(error, '加载 Pi Profile 失败'))
      })
      .finally(() => setLoadingPiProfiles(false))
  }, [piProfilesUrl])

  useEffect(() => {
    if (!repositoryId) return

    void Promise.resolve().then(() => Promise.all([
      loadRepository(),
      loadAIModels(),
      loadPiProfiles(),
    ]))
  }, [loadAIModels, loadPiProfiles, loadRepository, repositoryId])

  const resetPiProfileForm = () => {
    setPiProfileForm({
      ...emptyPiProfileForm,
      aiModelId: aiModels[0]?.id || '',
      sortOrder: piProfiles.length,
    })
  }

  const openCreatePiProfileDialog = () => {
    setPiProfileForm({
      ...emptyPiProfileForm,
      aiModelId: aiModels[0]?.id || '',
      sortOrder: piProfiles.length,
    })
    setPiProfileDialogOpen(true)
  }

  const openEditPiProfileDialog = (profile: PiProfile) => {
    setPiProfileForm({
      id: profile.id,
      name: profile.name,
      description: profile.description || '',
      aiModelId: profile.aiModelId,
      prompt: profile.prompt || '',
      promptMode: profile.promptMode || 'extend',
      isActive: profile.isActive,
      sortOrder: profile.sortOrder,
      maxFindings: toPositiveInteger(profile.maxFindings, 50),
    })
    setPiProfileDialogOpen(true)
  }

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
        setConfig({ watchBranches: updated.watchBranches || '' })
        toast.success('仓库配置已保存')
      })
      .catch((error) => {
        toast.error(toErrorMessage(error, '保存失败'))
      })
      .finally(() => setSaving(false))
  }

  const savePiProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!piProfileForm.name.trim()) {
      toast.error('请填写 Profile 名称')
      return
    }

    if (!piProfileForm.aiModelId) {
      toast.error('请选择 Pi Profile 使用的 AI 模型')
      return
    }

    if (!piProfilesUrl) {
      toast.error('仓库 ID 无效')
      return
    }

    setSavingPiProfile(true)

    return fetch(piProfilesUrl, {
      method: piProfileForm.id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(piProfileForm.id ? { id: piProfileForm.id } : {}),
        name: piProfileForm.name.trim(),
        description: piProfileForm.description.trim() || null,
        aiModelId: piProfileForm.aiModelId,
        prompt: piProfileForm.prompt.trim() || null,
        promptMode: piProfileForm.promptMode,
        isActive: piProfileForm.isActive,
        sortOrder: piProfileForm.sortOrder,
        maxFindings: piProfileForm.maxFindings,
      }),
    })
      .then((response) => {
        if (!response.ok) {
          return response.json().then((error) => {
            throw new Error(error.error || '保存 Pi Profile 失败')
          })
        }
        return response.json()
      })
      .then((savedProfile: PiProfile) => {
        setPiProfiles((currentProfiles) => {
          const nextProfiles = piProfileForm.id
            ? currentProfiles.map((profile) => profile.id === savedProfile.id ? savedProfile : profile)
            : [...currentProfiles, savedProfile]
          return sortPiProfiles(nextProfiles)
        })
        setPiProfileDialogOpen(false)
        resetPiProfileForm()
        toast.success(piProfileForm.id ? 'Pi Profile 已更新' : 'Pi Profile 已创建')
      })
      .catch((error) => {
        toast.error(toErrorMessage(error, '保存 Pi Profile 失败'))
      })
      .finally(() => setSavingPiProfile(false))
  }

  const updatePiProfile = (profile: PiProfile, changes: Partial<PiProfile>) => {
    if (!piProfilesUrl) return Promise.reject(new Error('仓库 ID 无效'))

    return fetch(piProfilesUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: profile.id,
        ...changes,
      }),
    })
      .then((response) => {
        if (!response.ok) {
          return response.json().then((error) => {
            throw new Error(error.error || '更新 Pi Profile 失败')
          })
        }
        return response.json()
      })
      .then((updatedProfile: PiProfile) => {
        setPiProfiles((currentProfiles) => {
          return sortPiProfiles(currentProfiles.map((item) => item.id === updatedProfile.id ? updatedProfile : item))
        })
        return updatedProfile
      })
  }

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

  const togglePiProfileActive = (profile: PiProfile) => {
    return updatePiProfile(profile, { isActive: !profile.isActive })
      .then((updatedProfile) => {
        toast.success(`${updatedProfile.name} 已${updatedProfile.isActive ? '启用' : '停用'}`)
      })
      .catch((error) => {
        toast.error(toErrorMessage(error, '更新 Pi Profile 失败'))
      })
  }

  const deletePiProfile = (profile: PiProfile) => {
    if (!piProfilesUrl) {
      toast.error('仓库 ID 无效')
      return
    }

    return fetch(`${piProfilesUrl}?id=${encodeURIComponent(profile.id)}`, {
      method: 'DELETE',
    })
      .then((response) => {
        if (!response.ok) {
          return response.json().then((error) => {
            throw new Error(error.error || '删除 Pi Profile 失败')
          })
        }
        return response.json()
      })
      .then(() => {
        setPiProfiles((currentProfiles) => currentProfiles.filter((item) => item.id !== profile.id))
        toast.success('Pi Profile 已删除')
      })
      .catch((error) => {
        toast.error(toErrorMessage(error, '删除 Pi Profile 失败'))
      })
  }

  const movePiProfile = (profile: PiProfile, direction: 'up' | 'down') => {
    const orderedProfiles = sortPiProfiles(piProfiles)
    const currentIndex = orderedProfiles.findIndex((item) => item.id === profile.id)
    const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    const targetProfile = orderedProfiles[nextIndex]

    if (currentIndex < 0 || !targetProfile) return

    return Promise.all([
      updatePiProfile(profile, { sortOrder: nextIndex }),
      updatePiProfile(targetProfile, { sortOrder: currentIndex }),
    ])
      .then(() => {
        setPiProfiles((currentProfiles) => {
          return sortPiProfiles(currentProfiles.map((item) => {
            if (item.id === profile.id) return { ...item, sortOrder: nextIndex }
            if (item.id === targetProfile.id) return { ...item, sortOrder: currentIndex }
            return item
          }))
        })
      })
      .catch((error) => {
        toast.error(toErrorMessage(error, '调整排序失败'))
        loadPiProfiles()
      })
  }

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

  const orderedPiProfiles = sortPiProfiles(piProfiles)
  const activePiProfileCount = orderedPiProfiles.filter((profile) => profile.isActive).length

  return (
    <div className="p-8 max-w-4xl mx-auto">
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
              <Badge variant={repository.isActive ? 'default' : 'secondary'}>
                {repository.isActive ? '活跃' : '未激活'}
              </Badge>
              <Badge variant="outline">
                {repository._count?.reviewLogs || 0} 次审查
              </Badge>
              <Button
                variant={repository.autoReview ? 'default' : 'outline'}
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

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>仓库配置</CardTitle>
          <CardDescription>
            这里仅保留仓库级触发配置。审查运行配置由下方 Pi Profile 决定。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>监听分支</Label>
            <Input
              placeholder="例如: main,develop,feature/* 或留空监听所有分支"
              value={config.watchBranches}
              onChange={(event) => setConfig({ ...config, watchBranches: event.target.value })}
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
                <Settings2 className="h-5 w-5" />
                Pi Profile
              </CardTitle>
              <CardDescription>
                排序第一的启用 Profile 会作为本次 Pi 审查的模型和 Prompt 配置来源。
              </CardDescription>
            </div>
            <Button onClick={openCreatePiProfileDialog} disabled={aiModels.length === 0}>
              <Plus className="h-4 w-4 mr-2" />
              新增 Profile
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">总数：{orderedPiProfiles.length}</Badge>
            <Badge variant={activePiProfileCount > 0 ? 'default' : 'secondary'}>
              启用：{activePiProfileCount}
            </Badge>
            <Badge variant="outline">可用模型：{aiModels.length}</Badge>
          </div>

          {aiModels.length === 0 && (
            <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
              暂无可用 AI 模型。请先在系统设置中启用模型，Pi Profile 只引用已有模型，不单独保存 API Key。
            </div>
          )}

          {loadingPiProfiles ? (
            <div className="flex items-center justify-center rounded-md border p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              正在加载 Pi Profile...
            </div>
          ) : orderedPiProfiles.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center">
              <p className="text-sm font-medium">还没有 Pi Profile</p>
              <p className="mt-1 text-sm text-muted-foreground">
                新增至少一个启用 Profile 后，手动审查、Webhook 和 Retry 才会进入 Pi 审查流程。
              </p>
              <Button className="mt-4" variant="outline" onClick={openCreatePiProfileDialog} disabled={aiModels.length === 0}>
                <Plus className="h-4 w-4 mr-2" />
                创建第一个 Profile
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {orderedPiProfiles.map((profile, index) => (
                <div key={profile.id} className="rounded-lg border bg-card p-4">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{profile.name}</p>
                        <Badge variant={profile.isActive ? 'default' : 'secondary'}>
                          {profile.isActive ? '启用' : '停用'}
                        </Badge>
                        <Badge variant="outline">
                          {profile.aiModel ? getModelDisplayName(profile.aiModel) : '模型缺失'}
                        </Badge>
                        <Badge variant="outline">
                          {profile.promptMode === 'replace' ? '替换 Prompt' : '扩展 Prompt'}
                        </Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <Badge variant="secondary">输出限制 {profile.maxFindings}</Badge>
                      </div>
                      {profile.description && (
                        <p className="mt-2 text-sm text-muted-foreground">{profile.description}</p>
                      )}
                      {profile.prompt ? (
                        <p className="mt-3 max-h-24 overflow-y-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
                          {profile.prompt}
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
                        onClick={() => movePiProfile(profile, 'up')}
                        disabled={index === 0}
                        title="上移"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-xs"
                        onClick={() => movePiProfile(profile, 'down')}
                        disabled={index === orderedPiProfiles.length - 1}
                        title="下移"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => togglePiProfileActive(profile)}>
                        {profile.isActive ? '停用' : '启用'}
                      </Button>
                      <Button variant="outline" size="icon-sm" onClick={() => openEditPiProfileDialog(profile)} title="编辑">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="icon-sm" onClick={() => deletePiProfile(profile)} title="删除">
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

      <Dialog open={piProfileDialogOpen} onOpenChange={(open) => {
        setPiProfileDialogOpen(open)
        if (!open) resetPiProfileForm()
      }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <form onSubmit={savePiProfile} className="space-y-5">
            <DialogHeader>
              <DialogTitle>{piProfileForm.id ? '编辑 Pi Profile' : '新增 Pi Profile'}</DialogTitle>
              <DialogDescription>
                Pi 会在仓库绑定的 OpenSandbox VM 内运行，使用该 Profile 的模型、Prompt 和输出限制。
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="pi-profile-name">Profile 名称</Label>
                <Input
                  id="pi-profile-name"
                  value={piProfileForm.name}
                  placeholder="例如：安全 Profile"
                  onChange={(event) => setPiProfileForm({ ...piProfileForm, name: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>AI 模型</Label>
                <Select
                  value={piProfileForm.aiModelId}
                  onValueChange={(value) => setPiProfileForm({ ...piProfileForm, aiModelId: value })}
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
              <Label htmlFor="pi-profile-description">描述</Label>
              <Input
                id="pi-profile-description"
                value={piProfileForm.description}
                placeholder="说明这个 Profile 关注的审查方向"
                onChange={(event) => setPiProfileForm({ ...piProfileForm, description: event.target.value })}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Prompt 模式</Label>
                <Select
                  value={piProfileForm.promptMode}
                  onValueChange={(value: PromptMode) => setPiProfileForm({ ...piProfileForm, promptMode: value })}
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
                  value={piProfileForm.isActive ? 'active' : 'inactive'}
                  onValueChange={(value) => setPiProfileForm({ ...piProfileForm, isActive: value === 'active' })}
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
                  只有启用 Profile 会参与下一次 Pi 审查；排序第一的启用 Profile 会被执行。
                </p>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="mb-4">
                <p className="text-sm font-medium">Pi 输出限制</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  控制单次审查最多保留多少条可定位问题，超出后会按去重结果截断。
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="pi-profile-max-findings">输出条数限制</Label>
                  <Input
                    id="pi-profile-max-findings"
                    type="number"
                    min={1}
                    max={200}
                    value={piProfileForm.maxFindings}
                    onChange={(event) => setPiProfileForm({
                      ...piProfileForm,
                      maxFindings: toPositiveInteger(event.target.value, 50),
                    })}
                  />
                  <p className="text-xs text-muted-foreground">1-200，默认 50。</p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pi-profile-prompt">Profile Prompt</Label>
              <Textarea
                id="pi-profile-prompt"
                rows={8}
                value={piProfileForm.prompt}
                placeholder="输入这个 Profile 的专属审查提示词，留空则使用内置 Prompt..."
                onChange={(event) => setPiProfileForm({ ...piProfileForm, prompt: event.target.value })}
              />
              <div className="flex flex-wrap gap-2">
                <span className="text-xs text-muted-foreground">快捷模板：</span>
                {defaultProfilePrompts.map((template) => (
                  <Button
                    key={template.name}
                    type="button"
                    variant="outline"
                    size="xs"
                    className="h-6 text-xs"
                    onClick={() => setPiProfileForm({ ...piProfileForm, prompt: template.prompt })}
                  >
                    {template.name}
                  </Button>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPiProfileDialogOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={savingPiProfile}>
                {savingPiProfile ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    保存中...
                  </>
                ) : (
                  '保存 Profile'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
