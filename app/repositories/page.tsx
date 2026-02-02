'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, GitFork, Loader2, Search, X, Settings } from 'lucide-react'
import { toast } from 'sonner'

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

type GitLabProject = {
  id: number
  name: string
  path: string
  path_with_namespace: string
  description: string | null
  default_branch: string
  web_url: string
}

type AIModel = {
  id: string
  provider: string
  modelId: string
  isActive: boolean
}

type Repository = {
  id: string
  gitLabProjectId: number
  name: string
  path: string
  description: string | null
  isActive: boolean
  autoReview: boolean
  defaultAIModelId: string | null
  defaultAIModel: AIModel | null
  gitLabAccount: {
    id: string
    url: string
  } | null
  branchConfigs: any[]
  _count: {
    reviewLogs: number
  }
}

export default function RepositoriesPage() {
  const [repositories, setRepositories] = useState<Repository[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // 添加仓库对话框状态
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [gitlabProjects, setGitlabProjects] = useState<GitLabProject[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)

  // 模型配置对话框状态
  const [showModelDialog, setShowModelDialog] = useState(false)
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null)
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const [aiModels, setAiModels] = useState<AIModel[]>([])

  const loadRepositories = async () => {
    try {
      const response = await fetch('/api/repositories')
      const data = await response.json()
      // 确保返回的是数组
      if (Array.isArray(data)) {
        setRepositories(data)
      } else {
        console.error('Unexpected response format:', data)
        setRepositories([])
      }
    } catch (error) {
      console.error('Failed to load repositories:', error)
      setRepositories([])
    } finally {
      setLoading(false)
    }
  }

  const loadAIModels = async () => {
    try {
      const response = await fetch('/api/settings/models')
      const data = await response.json()
      // 确保返回的是数组
      if (Array.isArray(data)) {
        setAiModels(data)
      } else {
        console.error('Unexpected AI models response format:', data)
        setAiModels([])
      }
    } catch (error) {
      console.error('Failed to load AI models:', error)
      setAiModels([])
    }
  }

  useEffect(() => {
    loadRepositories()
    loadAIModels()
  }, [])

  // 加载 GitLab 项目列表
  const loadGitLabProjects = async (search?: string) => {
    setLoadingProjects(true)
    try {
      const url = new URL('/api/settings/gitlab/projects', window.location.origin)
      if (search) {
        url.searchParams.set('search', search)
      }
      const response = await fetch(url.toString())
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to load projects')
      }
      const projects = await response.json()
      setGitlabProjects(projects)
    } catch (error) {
      toast.error('加载项目失败: ' + (error instanceof Error ? error.message : '未知错误'))
      setGitlabProjects([])
    } finally {
      setLoadingProjects(false)
    }
  }

  // 打开添加对话框时加载项目
  const handleOpenAddDialog = () => {
    setShowAddDialog(true)
    loadGitLabProjects()
  }

  // 搜索项目
  useEffect(() => {
    if (showAddDialog) {
      const timeoutId = setTimeout(() => {
        loadGitLabProjects(searchQuery)
      }, 300)
      return () => clearTimeout(timeoutId)
    }
  }, [searchQuery, showAddDialog])

  // 打开模型配置对话框
  const handleOpenModelDialog = (repo: Repository) => {
    setSelectedRepo(repo)
    setSelectedModelId(repo.defaultAIModelId || '')
    setShowModelDialog(true)
  }

  // 保存模型配置
  const handleSaveModel = async () => {
    if (!selectedRepo) return

    setSubmitting(true)
    try {
      const response = await fetch('/api/repositories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedRepo.id,
          defaultAIModelId: selectedModelId || null,
        }),
      })

      if (!response.ok) throw new Error('Failed to update repository')

      const updated = await response.json()
      setRepositories(repositories.map(r => r.id === selectedRepo.id ? updated : r))
      setShowModelDialog(false)
      toast.success(`模型配置已更新`)
    } catch (error) {
      toast.error('操作失败: ' + (error instanceof Error ? error.message : '未知错误'))
    } finally {
      setSubmitting(false)
    }
  }

  // 添加仓库
  const handleAddRepository = async (project: GitLabProject) => {
    setSubmitting(true)
    try {
      const response = await fetch('/api/repositories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gitLabProjectId: project.id,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to add repository')
      }

      const newRepo = await response.json()
      setRepositories([...repositories, newRepo])
      setShowAddDialog(false)
      setSearchQuery('')
      toast.success(`仓库 ${project.name} 已添加`)
    } catch (error) {
      toast.error('添加失败: ' + (error instanceof Error ? error.message : '未知错误'))
    } finally {
      setSubmitting(false)
    }
  }

  // 删除仓库
  const handleDeleteRepository = async (id: string) => {
    if (!confirm('确定要删除这个仓库吗？')) return

    try {
      const response = await fetch(`/api/repositories?id=${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) throw new Error('Failed to delete repository')

      setRepositories(repositories.filter(r => r.id !== id))
      toast.success('仓库已删除')
    } catch (error) {
      toast.error('删除失败: ' + (error instanceof Error ? error.message : '未知错误'))
    }
  }

  // 切换自动审查
  const handleToggleAutoReview = async (repo: Repository) => {
    try {
      const response = await fetch('/api/repositories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: repo.id,
          autoReview: !repo.autoReview,
        }),
      })

      if (!response.ok) throw new Error('Failed to update repository')

      const updated = await response.json()
      setRepositories(repositories.map(r => r.id === repo.id ? updated : r))
      toast.success(`自动审查已${repo.autoReview ? '禁用' : '启用'}`)
    } catch (error) {
      toast.error('操作失败: ' + (error instanceof Error ? error.message : '未知错误'))
    }
  }

  // 检查项目是否已添加
  const isProjectAdded = (projectId: number) => {
    return repositories.some(r => r.gitLabProjectId === projectId)
  }

  return (
    <div className="p-8">
      {/* 页面标题 */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground mb-1">
          仓库管理
        </h1>
        <p className="text-sm text-muted-foreground">
          管理和配置 GitLab 仓库的代码审查
        </p>
      </div>

      {/* 操作栏 */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">仓库列表</h2>
          <p className="text-sm text-muted-foreground">
            已添加 {repositories.length} 个仓库
          </p>
        </div>
        <Button onClick={handleOpenAddDialog}>
          <Plus className="h-4 w-4 mr-2" />
          添加仓库
        </Button>
      </div>

      {/* 仓库列表 */}
      <Card>
        <CardContent className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : repositories.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <GitFork className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>还没有添加任何仓库</p>
              <p className="text-xs mt-2">点击上方按钮添加第一个仓库</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-b-2">
                  <TableHead className="h-10 px-4 text-xs font-semibold text-muted-foreground">仓库名称</TableHead>
                  <TableHead className="h-10 px-4 text-xs font-semibold text-muted-foreground">GitLab 账号</TableHead>
                  <TableHead className="h-10 px-4 text-xs font-semibold text-muted-foreground">AI 模型</TableHead>
                  <TableHead className="h-10 px-4 text-xs font-semibold text-muted-foreground">分支配置</TableHead>
                  <TableHead className="h-10 px-4 text-xs font-semibold text-muted-foreground">自动审查</TableHead>
                  <TableHead className="h-10 px-4 text-xs font-semibold text-muted-foreground">状态</TableHead>
                  <TableHead className="h-10 px-4 text-xs font-semibold text-muted-foreground text-right">审查数</TableHead>
                  <TableHead className="h-10 px-4 text-xs font-semibold text-muted-foreground text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {repositories.map((repo) => (
                  <TableRow key={repo.id} className="hover:bg-muted/50">
                    <TableCell className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                          <GitFork className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{repo.name}</p>
                          <p className="text-xs text-muted-foreground">{repo.path}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <Badge variant="outline">
                        {repo.gitLabAccount?.url || '-'}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2"
                        onClick={() => handleOpenModelDialog(repo)}
                      >
                        {repo.defaultAIModel ? (
                          <Badge variant="default" className="font-normal">
                            {getModelDisplayName(repo.defaultAIModel)}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            全局默认
                          </Badge>
                        )}
                        <Settings className="h-3 w-3 ml-1 opacity-50" />
                      </Button>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <span className="text-sm text-muted-foreground">
                        {repo.branchConfigs?.length || 0} 个配置
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleAutoReview(repo)}
                      >
                        <Badge variant={repo.autoReview ? "default" : "secondary"}>
                          {repo.autoReview ? '启用' : '禁用'}
                        </Badge>
                      </Button>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <Badge variant={repo.isActive ? "default" : "secondary"}>
                        {repo.isActive ? '活跃' : '未激活'}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right text-sm text-muted-foreground">
                      {repo._count?.reviewLogs || 0}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDeleteRepository(repo.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 添加仓库对话框 */}
      {showAddDialog && (
        <div className="fixed inset-0 bg-background/80 flex items-center justify-center z-50">
          <Card className="w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
            <CardHeader className="border-b">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>添加仓库</CardTitle>
                  <CardDescription>
                    从您的 GitLab 账号中选择要添加的仓库
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setShowAddDialog(false)
                    setSearchQuery('')
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-6 overflow-y-auto flex-1">
              {/* 搜索框 */}
              <div className="space-y-2 mb-4">
                <Label>搜索仓库</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="输入仓库名称搜索..."
                    className="pl-9"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              {/* 项目列表 */}
              <div className="space-y-2">
                {loadingProjects ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : gitlabProjects.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground">
                    <GitFork className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>没有找到仓库</p>
                    <p className="text-xs mt-2">请尝试其他搜索关键词</p>
                  </div>
                ) : (
                  gitlabProjects.map((project) => {
                    const isAdded = isProjectAdded(project.id)
                    return (
                      <div
                        key={project.id}
                        className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <GitFork className="h-4 w-4 text-muted-foreground shrink-0" />
                            <p className="text-sm font-medium text-foreground truncate">
                              {project.name}
                            </p>
                            {isAdded && (
                              <Badge variant="secondary" className="shrink-0">已添加</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate ml-6">
                            {project.path_with_namespace}
                          </p>
                          {project.description && (
                            <p className="text-xs text-muted-foreground truncate ml-6 mt-1">
                              {project.description}
                            </p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleAddRepository(project)}
                          disabled={isAdded || submitting}
                        >
                          {isAdded ? '已添加' : '添加'}
                        </Button>
                      </div>
                    )
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 模型配置对话框 */}
      {showModelDialog && selectedRepo && (
        <div className="fixed inset-0 bg-background/80 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>配置 AI 模型</CardTitle>
                  <CardDescription>
                    为仓库 {selectedRepo.name} 选择 AI 模型
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowModelDialog(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>AI 模型</Label>
                <Select value={selectedModelId} onValueChange={setSelectedModelId}>
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
                  如果不选择模型，将使用配置页面中设置的全局默认模型
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button
                  variant="outline"
                  onClick={() => setShowModelDialog(false)}
                >
                  取消
                </Button>
                <Button onClick={handleSaveModel} disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      保存中
                    </>
                  ) : (
                    '保存'
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
