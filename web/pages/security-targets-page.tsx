import { useState } from 'react';
import { CalendarClockIcon, KeyRoundIcon, PencilIcon, PlusIcon, ShieldCheckIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';

import { ActionError, ResourceState } from '@web/components/common/resource-state';
import { ShellHeader } from '@web/components/layout/shell-header';
import { IdentityEditor } from '@web/components/security/identity-editor';
import { formatSecurityDate } from '@web/components/security/security-status';
import { TargetEditor } from '@web/components/security/target-editor';
import { Badge } from '@web/components/ui/badge';
import { Button } from '@web/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@web/components/ui/card';
import { useConfirm } from '@web/components/ui/confirm-dialog';
import { Modal } from '@web/components/ui/modal';
import { ScrollArea } from '@web/components/ui/scroll-area';
import { useAction, useResource } from '@web/hooks/use-resource';
import { api } from '@web/lib/api';
import { cn } from '@web/lib/utils';

import type { AIModelSummary, DingtalkRobot, RepositoryItem, SecurityIdentity, SecurityTarget } from '@web/lib/types';

function authorizationExpired(target: SecurityTarget) {
  return new Date(target.authorizedUntil).getTime() <= Date.now();
}

export function SecurityTargetsPage() {
  const targets = useResource<{ targets: SecurityTarget[] }>('/api/security/targets');
  const repositories = useResource<{ repositories: RepositoryItem[] }>('/api/repositories');
  const models = useResource<{ models: AIModelSummary[] }>('/api/settings/models');
  const robots = useResource<{ robots: DingtalkRobot[] }>('/api/settings/dingtalk');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<SecurityTarget | null>(null);
  const [identityTarget, setIdentityTarget] = useState<SecurityTarget | null>(null);
  const [identityEditorOpen, setIdentityEditorOpen] = useState(false);
  const [editingIdentity, setEditingIdentity] = useState<SecurityIdentity | null>(null);
  const identities = useResource<{ identities: SecurityIdentity[] }>(
    identityTarget ? `/api/security/targets/${identityTarget.id}/identities` : null,
  );
  const action = useAction();
  const confirmation = useConfirm();

  const removeTarget = (target: SecurityTarget) => {
    void confirmation.confirm({
      title: '删除安全测试目标',
      description: `确认删除「${target.name}」？关联工单、发现和证据记录会一并删除。`,
    }).then((approved) => {
      if (approved) action.execute(target.id, () => api(`/api/security/targets/${target.id}`, { method: 'DELETE' })
        .then(() => toast.success('目标已删除'))
        .then(targets.reload));
    });
  };

  const removeIdentity = (identity: SecurityIdentity) => {
    void confirmation.confirm({
      title: '删除测试身份',
      description: `确认删除「${identity.name}」？`,
    }).then((approved) => {
      if (approved) action.execute(identity.id, () => api(`/api/security/identities/${identity.id}`, { method: 'DELETE' })
        .then(() => toast.success('身份已删除'))
        .then(identities.reload));
    });
  };

  return <>
    <ShellHeader title="测试目标" meta="管理授权范围、测试身份和自动执行计划">
      <Button onClick={() => { setEditing(null); setEditorOpen(true); }}><PlusIcon />新增目标</Button>
    </ShellHeader>
    <ScrollArea className="min-h-0 flex-1"><div className="p-4 sm:p-6">
      <ActionError error={action.error} />
      <ResourceState loading={targets.loading && !targets.data} error={targets.error}
        empty={targets.data?.targets.length === 0} title="尚未配置安全测试目标"
        description="先登记授权人、授权依据和授权范围，再从工单页发起测试。" retry={targets.reload} />
      <div className="grid gap-5 xl:grid-cols-2">
        {targets.data?.targets.map((target) => {
          const expired = authorizationExpired(target);
          const scheduleActive = target.scheduleEnabled && target.isActive && !expired;
          return <Card key={target.id}>
            <CardHeader>
              <div className="flex items-start gap-3">
                <span className={cn('mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg',
                  target.isActive && !expired ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                  <ShieldCheckIcon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <CardTitle className="truncate">{target.name}</CardTitle>
                  <CardDescription className="mt-1 break-all">{target.baseUrl}</CardDescription>
                </div>
                <Badge variant="outline" className={expired ? 'border-destructive/40 text-destructive' : ''}>
                  {expired ? '授权已到期' : target.isActive ? '已启用' : '已停用'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <dl className="grid gap-4 text-xs sm:grid-cols-2">
                <div><dt className="mb-1.5 text-muted-foreground">授权人</dt><dd>{target.authorizationOwner}</dd></div>
                <div><dt className="mb-1.5 text-muted-foreground">授权截止</dt><dd>{formatSecurityDate(target.authorizedUntil)}</dd></div>
                <div className="sm:col-span-2"><dt className="mb-1.5 text-muted-foreground">授权依据</dt><dd className="break-words">{target.authorizationReference}</dd></div>
                <div className="sm:col-span-2"><dt className="mb-1.5 text-muted-foreground">测试范围</dt><dd className="flex flex-wrap gap-1.5">{target.scopeDomains.map((domain) => <Badge key={domain} variant="secondary">{domain}</Badge>)}</dd></div>
                <div><dt className="mb-1.5 text-muted-foreground">执行上限</dt><dd>{target.maxDurationMinutes} 分钟</dd></div>
                <div><dt className="mb-1.5 text-muted-foreground">计划</dt><dd className="flex items-center gap-1.5"><CalendarClockIcon className="size-3.5" />{target.scheduleEnabled ? scheduleActive ? `每 ${target.scheduleIntervalMinutes} 分钟` : '自动执行已暂停' : '手动触发'}</dd></div>
                <div className="sm:col-span-2"><dt className="mb-1.5 text-muted-foreground">下次执行</dt><dd>{scheduleActive ? formatSecurityDate(target.nextScheduledAt) : target.scheduleEnabled ? expired ? '授权已到期' : '目标已停用' : '未启用自动执行'}</dd></div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setIdentityTarget(target)}><KeyRoundIcon />测试身份</Button>
                <Button variant="outline" size="sm" onClick={() => { setEditing(target); setEditorOpen(true); }}><PencilIcon />编辑</Button>
                <Button variant="ghost" size="sm" disabled={Boolean(action.pending)} onClick={() => removeTarget(target)}><Trash2Icon />删除</Button>
              </div>
            </CardContent>
          </Card>;
        })}
      </div>
    </div></ScrollArea>
    <TargetEditor
      open={editorOpen}
      target={editing}
      repositories={repositories.data?.repositories ?? []}
      models={models.data?.models ?? []}
      robots={robots.data?.robots ?? []}
      onClose={() => setEditorOpen(false)}
      onSaved={targets.reload}
    />
    <Modal
      open={Boolean(identityTarget)}
      title={identityTarget ? `测试身份 · ${identityTarget.name}` : '测试身份'}
      onClose={() => setIdentityTarget(null)}
      maxWidth="sm:max-w-2xl"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">密码只用于运行时登录，页面不会读取明文。</p>
          <Button size="sm" onClick={() => { setEditingIdentity(null); setIdentityEditorOpen(true); }}><PlusIcon />添加身份</Button>
        </div>
        <ResourceState loading={identities.loading && !identities.data} error={identities.error}
          empty={identities.data?.identities.length === 0} title="尚未配置测试身份"
          description="没有身份时，Agent 只能执行匿名测试。" retry={identities.reload} />
        <div className="flex flex-col gap-2">
          {identities.data?.identities.map((identity) => <div key={identity.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{identity.name} <span className="text-xs text-muted-foreground">({identity.role})</span></p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{identity.username} · {identity.hasPassword ? '密码已配置' : '密码未配置'}</p>
            </div>
            <Badge variant={identity.isActive ? 'outline' : 'secondary'}>{identity.isActive ? '已启用' : '已停用'}</Badge>
            <Button variant="ghost" size="icon" aria-label={`编辑 ${identity.name}`} onClick={() => { setEditingIdentity(identity); setIdentityEditorOpen(true); }}><PencilIcon /></Button>
            <Button variant="ghost" size="icon" aria-label={`删除 ${identity.name}`} disabled={Boolean(action.pending)} onClick={() => removeIdentity(identity)}><Trash2Icon /></Button>
          </div>)}
        </div>
      </div>
    </Modal>
    <IdentityEditor
      open={identityEditorOpen}
      targetId={identityTarget?.id ?? ''}
      identity={editingIdentity}
      onClose={() => setIdentityEditorOpen(false)}
      onSaved={identities.reload}
    />
    {confirmation.element}
  </>;
}
