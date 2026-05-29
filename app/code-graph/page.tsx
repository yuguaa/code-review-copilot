'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { CodeGraphView } from '@/components/code-graph/code-graph-view'
import type {
  CodeGraphViewFile,
  CodeGraphViewRelation,
  CodeGraphViewSymbol,
} from '@/components/code-graph/code-graph-view'
import { ChevronDown, ChevronRight, GitBranch, GitCommit, GitFork, Loader2, Network, RefreshCw, Search } from 'lucide-react'

type GraphSnapshot = {
  id: string
  commitSha: string
  status: string
  lastIndexedAt: string
  architectureSummary: string
  updateMode: string | null
  baseBranch: string | null
  baseCommitSha: string | null
  sourceCommitSha: string | null
  indexedFiles: number | null
}

type GraphBranch = {
  name: string
  headCommitSha: string | null
  committedDate: string | null
  snapshots: GraphSnapshot[]
}

type GraphRepository = {
  id: string
  name: string
  path: string
  isActive: boolean
  branches: GraphBranch[]
}

type GraphSelection = {
  repositoryId: string
  branch: string
  commitSha: string
}

type GraphData = {
  snapshot?: GraphSnapshot | null
  files: CodeGraphViewFile[]
  symbols: CodeGraphViewSymbol[]
  relations: CodeGraphViewRelation[]
}

const shortSha = (sha?: string | null) => sha ? sha.slice(0, 8) : '无'

const buildGraphQuery = (selection: GraphSelection) => {
  const searchParams = new URLSearchParams()
  searchParams.set('branch', selection.branch)
  searchParams.set('commitSha', selection.commitSha)
  return searchParams.toString()
}

export default function CodeGraphPage() {
  const router = useRouter()
  const [repositories, setRepositories] = useState<GraphRepository[]>([])
  const [selection, setSelection] = useState<GraphSelection | null>(null)
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [loadingTree, setLoadingTree] = useState(true)
  const [loadingGraph, setLoadingGraph] = useState(false)
  const [generatingKey, setGeneratingKey] = useState<string | null>(null)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [graphError, setGraphError] = useState<string | null>(null)

  const selectedSnapshot = useMemo(() => {
    if (!selection) return null
    return repositories
      .find((repository) => repository.id === selection.repositoryId)
      ?.branches.find((branch) => branch.name === selection.branch)
      ?.snapshots.find((snapshot) => snapshot.commitSha === selection.commitSha) || null
  }, [repositories, selection])

  const selectedFile = useMemo(() => {
    if (!graphData?.files.length) return null
    return graphData.files.find((file) => file.filePath === selectedFilePath) || graphData.files[0]
  }, [graphData, selectedFilePath])

  const selectedRelations = useMemo(() => {
    if (!selectedFile || !graphData) return []
    return graphData.relations
      .filter((relation) => relation.from === selectedFile.filePath || relation.to === selectedFile.filePath)
      .slice(0, 16)
  }, [graphData, selectedFile])

  const filteredRepositories = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return repositories
    return repositories.filter((repository) => {
      return repository.name.toLowerCase().includes(normalizedQuery)
        || repository.path.toLowerCase().includes(normalizedQuery)
        || repository.branches.some((branch) => branch.name.toLowerCase().includes(normalizedQuery))
    })
  }, [query, repositories])

  const findSelection = useCallback((nextRepositories: GraphRepository[], params: URLSearchParams): GraphSelection | null => {
    const repositoryId = params.get('repositoryId')
    const branchName = params.get('branch')
    const commitSha = params.get('commitSha')

    if (repositoryId && branchName && commitSha) {
      const exists = nextRepositories.some((repository) => (
        repository.id === repositoryId
        && repository.branches.some((branch) => (
          branch.name === branchName
          && branch.snapshots.some((snapshot) => snapshot.commitSha === commitSha)
        ))
      ))
      if (exists) return { repositoryId, branch: branchName, commitSha }
    }

    const firstRepository = nextRepositories.find((repository) => repository.branches.length > 0)
    const firstBranch = firstRepository?.branches[0]
    const firstSnapshot = firstBranch?.snapshots[0]
    return firstRepository && firstBranch && firstSnapshot
      ? { repositoryId: firstRepository.id, branch: firstBranch.name, commitSha: firstSnapshot.commitSha }
      : null
  }, [])

  const selectSnapshot = useCallback((nextSelection: GraphSelection) => {
    setSelection(nextSelection)
    const params = new URLSearchParams()
    params.set('repositoryId', nextSelection.repositoryId)
    params.set('branch', nextSelection.branch)
    params.set('commitSha', nextSelection.commitSha)
    router.replace(`/code-graph?${params.toString()}`, { scroll: false })
  }, [router])

  const toggleExpanded = useCallback((key: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const loadTree = useCallback(() => {
    setLoadingTree(true)
    setTreeError(null)
    const currentParams = new URLSearchParams(window.location.search)
    return fetch('/api/code-graph/tree')
      .then((response) => {
        if (!response.ok) throw new Error('加载 Code Graph 树失败')
        return response.json()
      })
      .then((data) => {
        const nextRepositories = Array.isArray(data.repositories) ? data.repositories as GraphRepository[] : []
        setRepositories(nextRepositories)
        setSelection((current) => {
          if (current && nextRepositories.some((repository) => (
            repository.id === current.repositoryId
            && repository.branches.some((branch) => (
              branch.name === current.branch
              && branch.snapshots.some((snapshot) => snapshot.commitSha === current.commitSha)
            ))
          ))) {
            return current
          }
          return findSelection(nextRepositories, currentParams)
        })
        setExpandedKeys((current) => {
          const next = new Set(current)
          const nextSelection = findSelection(nextRepositories, currentParams)
          if (nextSelection) {
            next.add(`repo:${nextSelection.repositoryId}`)
            next.add(`branch:${nextSelection.repositoryId}:${nextSelection.branch}`)
          }
          return next
        })
      })
      .catch((error) => {
        console.error('Failed to load Code Graph tree:', error)
        setTreeError(error instanceof Error ? error.message : '加载 Code Graph 树失败')
      })
      .finally(() => setLoadingTree(false))
  }, [findSelection])

  const generateBranchGraph = useCallback((repositoryId: string, branchName: string) => {
    const key = `${repositoryId}:${branchName}`
    setGeneratingKey(key)
    setTreeError(null)

    return fetch(`/api/repositories/${repositoryId}/memory/refresh?branch=${encodeURIComponent(branchName)}&force=true`, {
      method: 'POST',
    })
      .then((response) => {
        if (!response.ok) throw new Error('生成分支 Code Graph 失败')
        return response.json()
      })
      .then((data) => {
        const commitSha = typeof data.snapshot?.commitSha === 'string' ? data.snapshot.commitSha : null
        if (commitSha) {
          selectSnapshot({ repositoryId, branch: branchName, commitSha })
        }
        return loadTree()
      })
      .catch((error) => {
        console.error('Failed to generate branch Code Graph:', error)
        setTreeError(error instanceof Error ? error.message : '生成分支 Code Graph 失败')
      })
      .finally(() => setGeneratingKey(null))
  }, [loadTree, selectSnapshot])

  const loadGraph = useCallback((nextSelection: GraphSelection | null) => {
    if (!nextSelection) {
      setGraphData(null)
      return Promise.resolve()
    }
    setLoadingGraph(true)
    setGraphError(null)
    return fetch(`/api/repositories/${nextSelection.repositoryId}/memory/graph?${buildGraphQuery(nextSelection)}`)
      .then((response) => {
        if (!response.ok) throw new Error('加载 Code Graph 图谱失败')
        return response.json()
      })
      .then((data) => {
        const files = Array.isArray(data.files) ? data.files as CodeGraphViewFile[] : []
        const symbols = Array.isArray(data.symbols) ? data.symbols as CodeGraphViewSymbol[] : []
        const relations = Array.isArray(data.relations) ? data.relations as CodeGraphViewRelation[] : []
        setGraphData({ snapshot: data.snapshot || null, files, symbols, relations })
        setSelectedFilePath((current) => current && files.some((file) => file.filePath === current) ? current : files[0]?.filePath || null)
      })
      .catch((error) => {
        console.error('Failed to load Code Graph:', error)
        setGraphData(null)
        setGraphError(error instanceof Error ? error.message : '加载 Code Graph 图谱失败')
      })
      .finally(() => setLoadingGraph(false))
  }, [])

  useEffect(() => {
    void Promise.resolve().then(loadTree)
  }, [loadTree])

  useEffect(() => {
    void Promise.resolve().then(() => loadGraph(selection))
  }, [loadGraph, selection])

  const graphFiles = graphData?.files || []
  const graphSymbols = graphData?.symbols || []
  const graphRelations = graphData?.relations || []

  return (
    <div className="flex h-[calc(100vh-1px)] min-h-0 bg-background">
      <aside className="flex w-[360px] shrink-0 flex-col border-r bg-muted/20">
        <div className="border-b p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
                <Network className="h-5 w-5" />
                Code Graph
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                按仓库、分支和 head 查看每份 Code Graph。
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={loadTree} disabled={loadingTree}>
              {loadingTree ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
          <div className="relative mt-4">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索仓库或分支"
              className="pl-9"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loadingTree ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在加载图谱树
            </div>
          ) : treeError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {treeError}
            </div>
          ) : filteredRepositories.length > 0 ? (
            <div className="space-y-3">
              {filteredRepositories.map((repository) => {
                const repoKey = `repo:${repository.id}`
                const repositoryExpanded = query.trim() || expandedKeys.has(repoKey)
                return (
                  <div key={repository.id} className="rounded-xl border bg-background/70 p-3 shadow-sm">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(repoKey)}
                      className="flex w-full items-start gap-2 rounded-lg text-left"
                    >
                      {repositoryExpanded ? (
                        <ChevronDown className="mt-0.5 h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="mt-0.5 h-4 w-4 text-muted-foreground" />
                      )}
                      <GitFork className="mt-0.5 h-4 w-4 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{repository.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{repository.path}</p>
                      </div>
                      <Badge variant="outline">{repository.branches.length}</Badge>
                    </button>
                    {repositoryExpanded && (
                      <div className="mt-3 space-y-3">
                        {repository.branches.length > 0 ? repository.branches.map((branch) => {
                          const branchKey = `branch:${repository.id}:${branch.name}`
                          const branchExpanded = query.trim() || expandedKeys.has(branchKey)
                          const latestSnapshot = branch.snapshots[0]
                          const hasHeadGraph = Boolean(
                            latestSnapshot &&
                            branch.headCommitSha &&
                            latestSnapshot.commitSha === branch.headCommitSha
                          )
                          const generating = generatingKey === `${repository.id}:${branch.name}`
                          return (
                            <div key={branch.name} className="border-l pl-3">
                              <div className="mb-2 flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => toggleExpanded(branchKey)}
                                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left text-xs font-medium text-muted-foreground"
                                >
                                  {branchExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                  <GitBranch className="h-3.5 w-3.5" />
                                  <span className="min-w-0 flex-1 truncate">{branch.name}</span>
                                  <Badge variant={hasHeadGraph ? 'outline' : 'secondary'} className="ml-auto">
                                    {hasHeadGraph ? `${branch.snapshots.length}` : '未生成'}
                                  </Badge>
                                </button>
                                <Button
                                  type="button"
                                  variant={hasHeadGraph ? 'ghost' : 'outline'}
                                  size="xs"
                                  disabled={generating}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    void generateBranchGraph(repository.id, branch.name)
                                  }}
                                >
                                  {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                  {hasHeadGraph ? '更新' : '生成'}
                                </Button>
                              </div>
                              {branchExpanded && (
                                <div className="space-y-1">
                                  {branch.headCommitSha && (
                                    <div className="rounded-lg bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
                                      HEAD <span className="font-mono">{shortSha(branch.headCommitSha)}</span>
                                      {branch.committedDate ? ` · ${new Date(branch.committedDate).toLocaleString('zh-CN')}` : ''}
                                    </div>
                                  )}
                                  {branch.snapshots.map((snapshot, index) => {
                                    const selected = selection?.repositoryId === repository.id
                                      && selection.branch === branch.name
                                      && selection.commitSha === snapshot.commitSha
                                    return (
                                      <button
                                        key={snapshot.id}
                                        type="button"
                                        onClick={() => selectSnapshot({
                                          repositoryId: repository.id,
                                          branch: branch.name,
                                          commitSha: snapshot.commitSha,
                                        })}
                                        className={[
                                          'w-full rounded-lg px-2 py-2 text-left text-xs transition active:scale-[0.99]',
                                          selected ? 'bg-primary text-primary-foreground shadow-sm' : 'hover:bg-muted',
                                        ].join(' ')}
                                      >
                                        <div className="flex items-center gap-2">
                                          <GitCommit className="h-3.5 w-3.5" />
                                          <span className="font-mono">{shortSha(snapshot.commitSha)}</span>
                                          {index === 0 && <span className={selected ? 'text-primary-foreground/75' : 'text-muted-foreground'}>最新</span>}
                                          {snapshot.updateMode && (
                                            <span className={selected ? 'text-primary-foreground/75' : 'text-muted-foreground'}>
                                              {snapshot.updateMode}
                                            </span>
                                          )}
                                        </div>
                                        <div className={selected ? 'mt-1 text-primary-foreground/70' : 'mt-1 text-muted-foreground'}>
                                          {new Date(snapshot.lastIndexedAt).toLocaleString('zh-CN')}
                                        </div>
                                      </button>
                                    )
                                  })}
                                  {branch.snapshots.length === 0 && (
                                    <p className="rounded-lg bg-muted p-2 text-xs text-muted-foreground">
                                      这个分支还没有 Code Graph，点击“生成”后会基于当前 HEAD 建图。
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        }) : (
                          <p className="rounded-lg bg-muted p-2 text-xs text-muted-foreground">暂无 Code Graph 快照</p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="rounded-xl border bg-background p-4 text-sm text-muted-foreground">
              暂无可展示的 Code Graph。选择左侧仓库分支后点击“生成”，系统会基于该分支当前 HEAD 建图。
            </p>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        {selection && selectedSnapshot ? (
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <GitCommit className="h-5 w-5" />
                      {shortSha(selection.commitSha)}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {repositories.find((repository) => repository.id === selection.repositoryId)?.path}
                      {' / '}
                      {selection.branch}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">当前快照 {shortSha(selection.commitSha)}</Badge>
                    <Badge variant="outline">基础快照 {shortSha(selectedSnapshot.baseCommitSha)}</Badge>
                    <Badge variant="outline">触发提交 {shortSha(selectedSnapshot.sourceCommitSha)}</Badge>
                    {selectedSnapshot.indexedFiles !== null && (
                      <Badge variant="secondary">索引文件 {selectedSnapshot.indexedFiles}</Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                  {selectedSnapshot.architectureSummary || '暂无架构摘要'}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>图谱视图</CardTitle>
                    <CardDescription>
                      文件节点、符号节点和跨文件关系来自当前 head 的 Code Graph 快照。
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge variant="outline">文件 {graphFiles.length}</Badge>
                    <Badge variant="outline">符号 {graphSymbols.length}</Badge>
                    <Badge variant="outline">关系 {graphRelations.length}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {loadingGraph ? (
                  <div className="flex h-[520px] items-center justify-center rounded-xl border bg-muted text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    正在加载图谱
                  </div>
                ) : graphError ? (
                  <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center text-sm text-destructive">
                    {graphError}
                  </p>
                ) : graphFiles.length > 0 ? (
                  <>
                    <CodeGraphView
                      files={graphFiles}
                      symbols={graphSymbols}
                      relations={graphRelations}
                      selectedFilePath={selectedFile?.filePath || null}
                      onSelectFile={setSelectedFilePath}
                    />
                    <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
                      <div className="rounded-xl border p-4">
                        <p className="font-medium">{selectedFile?.filePath || '未选择节点'}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {selectedFile ? `${selectedFile.role} / ${selectedFile.language}` : '点击图谱节点查看详情'}
                        </p>
                        {selectedFile?.summary && (
                          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{selectedFile.summary}</p>
                        )}
                      </div>
                      <div className="rounded-xl border p-4 text-xs">
                        <p className="mb-3 font-medium">相关关系</p>
                        {selectedRelations.length > 0 ? (
                          <div className="space-y-2">
                            {selectedRelations.map((relation) => (
                              <div key={relation.id} className="rounded-lg bg-muted p-2">
                                <Badge variant="secondary" className="mr-2">{relation.relationType}</Badge>
                                <span>{relation.from} → {relation.to || 'external'}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-muted-foreground">暂无关联边</p>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="rounded-xl border bg-muted p-8 text-center text-sm text-muted-foreground">
                    当前快照没有可展示的图谱节点。
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center rounded-2xl border bg-muted/30 p-10 text-center">
            <div>
              <Network className="mx-auto h-10 w-10 text-muted-foreground" />
              <h2 className="mt-4 text-lg font-semibold">选择一个 Code Graph 快照</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                左侧按仓库、分支和 head 组织，每个 head 都对应一份可参考的图谱。
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
