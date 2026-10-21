import { useState } from 'react';
import { CopyIcon, FolderGit2Icon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';

import { ResourceState } from '@web/components/common/resource-state';
import { ShellHeader } from '@web/components/layout/shell-header';
import { RepositoryEditor } from '@web/components/repositories/repository-editor';
import { Alert, AlertDescription, AlertTitle } from '@web/components/ui/alert';
import { Badge } from '@web/components/ui/badge';
import { Button } from '@web/components/ui/button';
import { useConfirm } from '@web/components/ui/confirm-dialog';
import { ScrollArea } from '@web/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@web/components/ui/table';
import { useAction, useResource } from '@web/hooks/use-resource';
import { api } from '@web/lib/api';

import type { AIModelSummary, GitLabAccount, Repository } from '@web/lib/types';

export function Repositories() {
  const resource = useResource<{ repositories: Repository[] }>('/api/repositories');
  const accounts = useResource<{ accounts: GitLabAccount[] }>('/api/settings/gitlab');
  const models = useResource<{ models: AIModelSummary[] }>('/api/settings/models');
  const [editor, setEditor] = useState<{ repository: Repository | null } | null>(null);
  const action = useAction();
  const confirmation = useConfirm();
  const webhook = `${window.location.origin}/api/webhook/gitlab`;
  const remove = (repository: Repository) => { void confirmation.confirm({ title: '删除仓库配置', description: `确认删除 ${repository.path}？该仓库将停止接收自动审查。` }).then((approved) => { if (approved) action.execute(repository.id, () => api(`/api/repositories/${repository.id}`, { method: 'DELETE' }).then(resource.reload)); }); };
  return <><ShellHeader title="仓库" meta="配置监听分支、OCR 参数与报告渠道"><Button disabled={!accounts.data || !models.data} onClick={() => setEditor({ repository: null })}><PlusIcon />添加仓库</Button></ShellHeader><ScrollArea className="min-h-0 flex-1"><div className="flex min-w-0 flex-col gap-5 p-4 sm:p-6"><Alert><FolderGit2Icon /><AlertTitle>GitLab Webhook</AlertTitle><AlertDescription><div className="flex flex-wrap items-center gap-3"><code className="break-all text-xs">{webhook}</code><Button variant="ghost" size="xs" onClick={() => { void navigator.clipboard.writeText(webhook).then(() => toast.success('Webhook 地址已复制')).catch(() => toast.error('复制失败，请手动复制地址')); }}><CopyIcon />复制地址</Button></div><p>在 GitLab 项目中启用 Merge Request 和 Push 事件，Secret Token 使用对应账号的 Webhook Secret。</p></AlertDescription></Alert><ResourceState loading={resource.loading && !resource.data} error={resource.error || accounts.error || models.error} empty={resource.data?.repositories.length === 0} title="尚未添加仓库" description="连接 GitLab 账号后，选择项目并配置审查参数。" retry={() => { void resource.reload(); void accounts.reload(); void models.reload(); }} />{resource.data && resource.data.repositories.length > 0 && <ScrollArea orientation="horizontal" className="rounded-lg border bg-card"><Table><TableHeader><TableRow><TableHead>仓库</TableHead><TableHead>监听分支</TableHead><TableHead>模型</TableHead><TableHead>审查</TableHead><TableHead>发布渠道</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>{resource.data.repositories.map((repo) => <TableRow key={repo.id}><TableCell><span className="font-medium">{repo.name}</span><p className="mt-1 text-xs text-muted-foreground">{repo.path}</p></TableCell><TableCell className="text-xs">{repo.watchBranches || '全部分支'}</TableCell><TableCell className="text-xs">{repo.customModelId || repo.defaultAIModel?.modelId || '全局默认模型'}</TableCell><TableCell><Badge variant={repo.autoReview ? 'outline' : 'secondary'}>{repo.autoReview ? '自动审查' : '手动审查'}</Badge><p className="mt-1.5 text-[11px] text-muted-foreground">并发 {repo.ocrConcurrency} · {repo.ocrTimeoutMinutes} 分钟</p></TableCell><TableCell className="text-xs text-muted-foreground">{[repo.enableMrComment && 'GitLab', repo.enableDingtalk && '钉钉'].filter(Boolean).join(' · ') || '未启用'}</TableCell><TableCell><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" aria-label={`编辑 ${repo.name}`} disabled={!accounts.data || !models.data} onClick={() => setEditor({ repository: repo })}><PencilIcon /></Button><Button variant="ghost" size="icon" aria-label={`删除 ${repo.name}`} disabled={Boolean(action.pending)} onClick={() => remove(repo)}><Trash2Icon /></Button></div></TableCell></TableRow>)}</TableBody></Table></ScrollArea>}</div></ScrollArea>{editor && accounts.data && models.data && <RepositoryEditor repository={editor.repository} accounts={accounts.data.accounts} models={models.data.models} close={() => setEditor(null)} saved={resource.reload} />}{confirmation.element}</>;
}
