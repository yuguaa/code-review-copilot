import { useState } from 'react';
import { toast } from 'sonner';

import { SecretField } from '@web/components/common/configuration-form';
import { ActionError, ResourceState } from '@web/components/common/resource-state';
import { DingtalkCliCard } from './dingtalk-cli-card';
import { Badge } from '@web/components/ui/badge';
import { Button } from '@web/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@web/components/ui/card';
import { useConfirm } from '@web/components/ui/confirm-dialog';
import { Checkbox, Field, FieldGroup, Input } from '@web/components/ui/forms';
import { Modal } from '@web/components/ui/modal';
import { useAction, useResource } from '@web/hooks/use-resource';
import { api } from '@web/lib/api';

import type { DingtalkRobot } from '@web/lib/types';

const emptyForm = { name: '', webhookUrl: '', secret: '' as string | null, enabled: true };

export function DingtalkPanel() {
  const resource = useResource<{ robots: DingtalkRobot[] }>('/api/settings/dingtalk');
  const [editing, setEditing] = useState<DingtalkRobot | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const action = useAction();
  const confirmation = useConfirm();
  const save = () => action.execute('save', () => api(editing ? `/api/settings/dingtalk/${editing.id}` : '/api/settings/dingtalk', {
    method: editing ? 'PATCH' : 'POST', body: JSON.stringify({ ...form, transport: 'webhook' }),
  }).then(() => { setOpen(false); toast.success('钉钉连接已保存'); return resource.reload(); }));
  return <div className="flex max-w-3xl flex-col gap-5">
    <ActionError error={action.error} />
    <DingtalkCliCard />
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Webhook 决定群内报告和 @ 消息的目标；共享 CLI 提供 Pi 查人和消息能力。OCR 自动通知只发送一条原群报告，对话发送由你确认。</p>
          <Button disabled={Boolean(action.pending)} onClick={() => { setEditing(null); setForm(emptyForm); setOpen(true); }}>添加 Webhook</Button></div>
        <ResourceState loading={resource.loading && !resource.data} error={resource.error} empty={resource.data?.robots.length === 0} title="尚未添加 Webhook" description="群通知可单独添加 Webhook；CLI 只需在上方扫码授权。" retry={resource.reload} />
        {resource.data?.robots.map((robot) => <Card key={robot.id}>
          <CardHeader><CardTitle className="flex flex-wrap items-center gap-2">{robot.name}<Badge variant="outline">{robot.transport === 'cli' ? 'DWS CLI' : 'Webhook'}</Badge><Badge variant={robot.enabled ? 'outline' : 'secondary'}>{robot.enabled ? '已启用' : '已停用'}</Badge></CardTitle>
            <CardDescription>Webhook：{robot.hasWebhookUrl ? '已配置' : '未配置'} · Secret：{robot.hasSecret ? '已配置' : '未配置'}</CardDescription>
            <CardDescription>仓库 {robot.repositoryCount} · RSS {robot.rssSubscriptionCount} · 安全目标 {robot.securityTargetCount}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={Boolean(action.pending)} onClick={() => { setEditing(robot); setForm({ ...emptyForm, name: robot.name, enabled: robot.enabled }); setOpen(true); }}>编辑</Button>
            <Button variant="outline" size="sm" disabled={Boolean(action.pending)} onClick={() => action.execute(robot.id, () => api(`/api/settings/dingtalk/${robot.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !robot.enabled }) }).then(resource.reload))}>{robot.enabled ? '停用' : '启用'}</Button>
            <Button variant="ghost" size="sm" disabled={Boolean(action.pending)} onClick={() => { void confirmation.confirm({ title: '删除钉钉连接', description: `确认删除「${robot.name}」？有关联配置、名单或发送记录的连接不能删除。` }).then((approved) => { if (approved) action.execute(robot.id, () => api(`/api/settings/dingtalk/${robot.id}`, { method: 'DELETE' }).then(resource.reload)); }); }}>删除</Button>
          </CardContent>
        </Card>)}
    <Modal open={open} title={editing ? '编辑钉钉连接' : '添加钉钉连接'} onClose={() => !action.pending && setOpen(false)} maxWidth="sm:max-w-xl">
      <form className="flex flex-col gap-6" onSubmit={(event) => { event.preventDefault(); save(); }}>
        <ActionError error={action.error} /><FieldGroup>
          <Field label="连接名称"><Input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></Field>
            <SecretField label="Webhook URL" value={form.webhookUrl} required={!editing?.hasWebhookUrl} configured={editing?.hasWebhookUrl} onChange={(value) => setForm((current) => ({ ...current, webhookUrl: value ?? '' }))} />
            <SecretField label="签名 Secret" value={form.secret} configured={editing?.hasSecret} clearable onChange={(value) => setForm((current) => ({ ...current, secret: value }))} />
          <Checkbox label="启用连接" checked={form.enabled} onChange={(enabled) => setForm((current) => ({ ...current, enabled }))} />
        </FieldGroup>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={Boolean(action.pending)} onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={Boolean(action.pending)}>{action.pending === 'save' ? '正在保存…' : '保存配置'}</Button></div>
      </form>
    </Modal>{confirmation.element}
  </div>;
}
