import { useState } from 'react';
import { toast } from 'sonner';

import { SecretField } from '@web/components/common/configuration-form';
import { ActionError, ResourceState } from '@web/components/common/resource-state';
import { DingtalkPeople } from './dingtalk-people';
import { Badge } from '@web/components/ui/badge';
import { Button } from '@web/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@web/components/ui/card';
import { useConfirm } from '@web/components/ui/confirm-dialog';
import { Checkbox, Field, FieldGroup, Input, Select } from '@web/components/ui/forms';
import { Modal } from '@web/components/ui/modal';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@web/components/ui/tabs';
import { useAction, useResource } from '@web/hooks/use-resource';
import { api } from '@web/lib/api';

import type { DingtalkRobot } from '@web/lib/types';

const emptyForm = { name: '', transport: 'webhook' as 'webhook' | 'cli', webhookUrl: '', secret: '' as string | null,
  cliProfile: '', cliRobotCode: '', cliGroupId: '', enabled: true };

export function DingtalkPanel() {
  const resource = useResource<{ robots: DingtalkRobot[] }>('/api/settings/dingtalk');
  const [editing, setEditing] = useState<DingtalkRobot | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [directory, setDirectory] = useState('');
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const action = useAction();
  const confirmation = useConfirm();
  const save = () => action.execute('save', () => api(editing ? `/api/settings/dingtalk/${editing.id}` : '/api/settings/dingtalk', {
    method: editing ? 'PATCH' : 'POST', body: JSON.stringify({ name: form.name, transport: form.transport, enabled: form.enabled,
      ...(form.transport === 'webhook' ? { webhookUrl: form.webhookUrl, secret: form.secret }
        : { cliProfile: form.cliProfile, cliRobotCode: form.cliRobotCode, cliGroupId: form.cliGroupId }),
    }),
  }).then(() => { setOpen(false); toast.success('钉钉连接已保存'); return resource.reload(); }));
  const cliConnections = resource.data?.robots.filter((robot) => robot.transport === 'cli' && robot.enabled) ?? [];
  return <div className="flex max-w-3xl flex-col gap-5">
    <ActionError error={action.error} />
    <Tabs defaultValue="connections"><TabsList variant="line"><TabsTrigger value="connections">通知连接</TabsTrigger><TabsTrigger value="people">人员名单</TabsTrigger></TabsList>
      <TabsContent value="connections" className="flex flex-col gap-4 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Webhook 群通知与 DWS CLI 群消息、@、私聊分别配置。</p>
          <Button disabled={Boolean(action.pending)} onClick={() => { setEditing(null); setForm(emptyForm); setOpen(true); }}>添加连接</Button></div>
        <ResourceState loading={resource.loading && !resource.data} error={resource.error} empty={resource.data?.robots.length === 0} title="尚未添加钉钉连接" description="添加 Webhook 或已授权的 DWS CLI 连接。" retry={resource.reload} />
        {resource.data?.robots.map((robot) => <Card key={robot.id}>
          <CardHeader><CardTitle className="flex flex-wrap items-center gap-2">{robot.name}<Badge variant="outline">{robot.transport === 'cli' ? 'DWS CLI' : 'Webhook'}</Badge><Badge variant={robot.enabled ? 'outline' : 'secondary'}>{robot.enabled ? '已启用' : '已停用'}</Badge></CardTitle>
            <CardDescription>{robot.transport === 'cli' ? `Profile：${robot.cliProfile} · 群 ID：${robot.cliGroupId}` : `Webhook：${robot.hasWebhookUrl ? '已配置' : '未配置'} · Secret：${robot.hasSecret ? '已配置' : '未配置'}`}</CardDescription>
            <CardDescription>仓库 {robot.repositoryCount} · RSS {robot.rssSubscriptionCount} · 安全目标 {robot.securityTargetCount}</CardDescription>
            {statuses[robot.id] && <p role="status" className="text-sm">{statuses[robot.id]}</p>}
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {robot.transport === 'cli' && <Button variant="outline" size="sm" disabled={!robot.enabled || Boolean(action.pending)} onClick={() => action.execute(robot.id, () => api<{ status: { authenticated: boolean; tokenValid: boolean; userName: string | null; corpName: string | null } }>(`/api/settings/dingtalk/${robot.id}/status`, { method: 'POST' }).then(({ status }) => setStatuses((current) => ({ ...current, [robot.id]: status.authenticated && status.tokenValid ? `授权有效：${status.corpName ?? ''} / ${status.userName ?? ''}` : '未授权或授权已过期，请在 CLI Worker 中完成钉钉授权。' }))))}>检查授权</Button>}
            <Button variant="outline" size="sm" disabled={Boolean(action.pending)} onClick={() => { setEditing(robot); setForm({ ...emptyForm, name: robot.name, transport: robot.transport, enabled: robot.enabled, cliProfile: robot.cliProfile ?? '', cliRobotCode: robot.cliRobotCode ?? '', cliGroupId: robot.cliGroupId ?? '' }); setOpen(true); }}>编辑</Button>
            <Button variant="outline" size="sm" disabled={Boolean(action.pending)} onClick={() => action.execute(robot.id, () => api(`/api/settings/dingtalk/${robot.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !robot.enabled }) }).then(resource.reload))}>{robot.enabled ? '停用' : '启用'}</Button>
            <Button variant="ghost" size="sm" disabled={Boolean(action.pending)} onClick={() => { void confirmation.confirm({ title: '删除钉钉连接', description: `确认删除「${robot.name}」？有关联配置、名单或发送记录的连接不能删除。` }).then((approved) => { if (approved) action.execute(robot.id, () => api(`/api/settings/dingtalk/${robot.id}`, { method: 'DELETE' }).then(resource.reload)); }); }}>删除</Button>
          </CardContent>
        </Card>)}
      </TabsContent>
      <TabsContent value="people" className="flex flex-col gap-4 pt-4">
        <Field label="钉钉 CLI 连接" hint="名单按 Profile 所属连接隔离，工号不跨组织复用。"><Select value={directory} onChange={(event) => setDirectory(event.target.value)}><option value="">请选择连接</option>{cliConnections.map((robot) => <option value={robot.id} key={robot.id}>{robot.name}</option>)}</Select></Field>
        {directory && cliConnections.some((robot) => robot.id === directory) && <DingtalkPeople key={directory} connectionId={directory} />}
      </TabsContent>
    </Tabs>
    <Modal open={open} title={editing ? '编辑钉钉连接' : '添加钉钉连接'} onClose={() => !action.pending && setOpen(false)} maxWidth="sm:max-w-xl">
      <form className="flex flex-col gap-6" onSubmit={(event) => { event.preventDefault(); save(); }}>
        <ActionError error={action.error} /><FieldGroup>
          <Field label="连接名称"><Input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></Field>
          <Field label="通知方式"><Select disabled={Boolean(editing)} value={form.transport} onChange={(event) => setForm((current) => ({ ...current, transport: event.target.value as typeof form.transport }))}><option value="webhook">Webhook 机器人</option><option value="cli">DingTalk CLI</option></Select></Field>
          {form.transport === 'webhook' ? <>
            <SecretField label="Webhook URL" value={form.webhookUrl} required={!editing?.hasWebhookUrl} configured={editing?.hasWebhookUrl} onChange={(value) => setForm((current) => ({ ...current, webhookUrl: value ?? '' }))} />
            <SecretField label="签名 Secret" value={form.secret} configured={editing?.hasSecret} clearable onChange={(value) => setForm((current) => ({ ...current, secret: value }))} />
          </> : <>
            <Field label="CLI Profile" hint="填写明确的 corpId:userId，不使用当前账号或默认组织。"><Input required value={form.cliProfile} placeholder="corpId:userId" onChange={(event) => setForm((current) => ({ ...current, cliProfile: event.target.value }))} /></Field>
            <Field label="Robot Code"><Input required value={form.cliRobotCode} onChange={(event) => setForm((current) => ({ ...current, cliRobotCode: event.target.value }))} /></Field>
            <Field label="默认群 ID" hint="钉钉 openConversationId；机器人必须已加入该群。"><Input required value={form.cliGroupId} onChange={(event) => setForm((current) => ({ ...current, cliGroupId: event.target.value }))} /></Field>
            <p className="text-xs leading-6 text-muted-foreground">启用独立 DWS Worker 后，在该容器执行 dws auth login --device --recommend 完成企业授权。CLI 路径与凭据目录由部署控制，不接受网页或 AI 指定。</p>
          </>}
          <Checkbox label="启用连接" checked={form.enabled} onChange={(enabled) => setForm((current) => ({ ...current, enabled }))} />
        </FieldGroup>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={Boolean(action.pending)} onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={Boolean(action.pending)}>{action.pending === 'save' ? '正在保存…' : '保存配置'}</Button></div>
      </form>
    </Modal>{confirmation.element}
  </div>;
}
