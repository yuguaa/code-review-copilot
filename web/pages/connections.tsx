import { useState } from 'react';
import { PencilIcon, PlusIcon, Trash2Icon, ZapIcon } from 'lucide-react';
import { toast } from 'sonner';

import { SecretField } from '@web/components/common/configuration-form';
import { ActionError, ResourceState } from '@web/components/common/resource-state';
import { ShellHeader } from '@web/components/layout/shell-header';
import { Badge } from '@web/components/ui/badge';
import { Button } from '@web/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@web/components/ui/card';
import { useConfirm } from '@web/components/ui/confirm-dialog';
import { Checkbox, Field, FieldGroup, Input } from '@web/components/ui/forms';
import { Modal } from '@web/components/ui/modal';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@web/components/ui/tabs';
import { useAction, useResource } from '@web/hooks/use-resource';
import { api } from '@web/lib/api';

import type { DingtalkRobot, GitLabAccount } from '@web/lib/types';

const emptyAccount = { url: '', accessToken: '', webhookSecret: '', isActive: true };

function GitLabPanel() {
  const accounts = useResource<{ accounts: GitLabAccount[] }>('/api/settings/gitlab');
  const [editing, setEditing] = useState<GitLabAccount | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyAccount);
  const action = useAction();
  const confirmation = useConfirm();
  const remove = (account: GitLabAccount) => {
    void confirmation.confirm({ title: '删除 GitLab 账号', description: `确认删除 ${account.url} 的连接配置？关联仓库的使用情况由服务端检查。` }).then((approved) => {
      if (approved) action.execute(account.id, () => api(`/api/settings/gitlab/${account.id}`, { method: 'DELETE' }).then(accounts.reload));
    });
  };
  const save = () => action.execute('save', () => api(editing ? `/api/settings/gitlab/${editing.id}` : '/api/settings/gitlab', {
    method: editing ? 'PATCH' : 'POST', body: JSON.stringify(form),
  }).then(() => { setOpen(false); toast.success('GitLab 配置已保存'); return accounts.reload(); }));

  return <>
    <ActionError error={action.error} />
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">连接 GitLab 实例，接收仓库变更事件。</p>
      <Button onClick={() => { setEditing(null); setForm(emptyAccount); setOpen(true); }}><PlusIcon />添加账号</Button>
    </div>
    <ResourceState loading={accounts.loading && !accounts.data} error={accounts.error} empty={accounts.data?.accounts.length === 0} title="尚未连接 GitLab" description="添加实例地址、Access Token 和 Webhook Secret。" retry={accounts.reload} />
    <div className="flex flex-col gap-4">
      {accounts.data?.accounts.map((account) => <Card key={account.id}>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">{account.url}<Badge variant="outline">{account.isActive ? '已启用' : '已停用'}</Badge></CardTitle>
          <CardDescription>Access Token：{account.hasAccessToken ? '已配置' : '未配置'} · Webhook Secret：{account.hasWebhookSecret ? '已配置' : '需要配置'}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={Boolean(action.pending)} onClick={() => action.execute(account.id, () => api<{ ok: boolean }>(`/api/settings/gitlab/${account.id}/test`, { method: 'POST' }).then(({ ok }) => { ok ? toast.success('GitLab 连接正常') : toast.error('GitLab 连接失败，请检查配置'); }))}><ZapIcon />测试连接</Button>
          <Button variant="outline" size="sm" onClick={() => { setEditing(account); setForm({ ...emptyAccount, url: account.url, isActive: account.isActive }); setOpen(true); }}><PencilIcon />编辑</Button>
          <Button variant="ghost" size="sm" disabled={Boolean(action.pending)} onClick={() => remove(account)}><Trash2Icon />删除</Button>
        </CardContent>
      </Card>)}
    </div>
    <Modal open={open} title={editing ? '编辑 GitLab 账号' : '添加 GitLab 账号'} onClose={() => !action.pending && setOpen(false)} maxWidth="sm:max-w-lg">
      <form className="flex flex-col gap-6" onSubmit={(event) => { event.preventDefault(); save(); }}>
        <ActionError error={action.error} />
        <FieldGroup>
          <Field label="GitLab 实例地址"><Input type="url" required value={form.url} onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))} placeholder="https://gitlab.example.com" /></Field>
          <SecretField label="Access Token" required={!editing?.hasAccessToken} configured={editing?.hasAccessToken} value={form.accessToken} onChange={(value) => setForm((current) => ({ ...current, accessToken: value ?? '' }))} />
          <SecretField label="Webhook Secret" required={!editing?.hasWebhookSecret} configured={editing?.hasWebhookSecret} value={form.webhookSecret} onChange={(value) => setForm((current) => ({ ...current, webhookSecret: value ?? '' }))} />
          <p className="text-xs leading-6 text-muted-foreground">接入 Webhook 必须配置 Secret，并在 GitLab 项目的 Secret Token 中填写相同内容。</p>
          <Checkbox label="启用账号" checked={form.isActive} onChange={(value) => setForm((current) => ({ ...current, isActive: value }))} />
        </FieldGroup>
        <div className="flex justify-end gap-2"><Button variant="outline" disabled={Boolean(action.pending)} onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={Boolean(action.pending)}>{action.pending === 'save' ? '正在保存…' : '保存配置'}</Button></div>
      </form>
    </Modal>
    {confirmation.element}
  </>;
}

function NotificationPanel() {
  const resource = useResource<{ robots: DingtalkRobot[] }>('/api/settings/dingtalk');
  const [editing, setEditing] = useState<DingtalkRobot | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', webhookUrl: '', secret: '' as string | null, enabled: true });
  const action = useAction();
  const confirmation = useConfirm();
  const save = () => action.execute('save', () => api(editing ? `/api/settings/dingtalk/${editing.id}` : '/api/settings/dingtalk', {
    method: editing ? 'PATCH' : 'POST', body: JSON.stringify(form),
  }).then(() => { setOpen(false); toast.success('机器人配置已保存'); return resource.reload(); }));
  const remove = (robot: DingtalkRobot) => {
    void confirmation.confirm({ title: '删除钉钉机器人', description: `确认删除「${robot.name}」？关联仓库或 RSS 订阅时无法删除。` }).then((approved) => {
      if (approved) action.execute(robot.id, () => api(`/api/settings/dingtalk/${robot.id}`, { method: 'DELETE' }).then(resource.reload));
    });
  };

  return <div className="flex max-w-2xl flex-col gap-5">
    <ActionError error={action.error} />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">为仓库和 RSS 订阅分别选择通知机器人。</p>
      <Button disabled={Boolean(action.pending)} onClick={() => { setEditing(null); setForm({ name: '', webhookUrl: '', secret: '', enabled: true }); setOpen(true); }}><PlusIcon />添加机器人</Button>
    </div>
    <ResourceState loading={resource.loading && !resource.data} error={resource.error} empty={resource.data?.robots.length === 0} title="尚未添加机器人" description="添加钉钉机器人的 Webhook 和签名配置。" retry={resource.reload} />
    {resource.data?.robots.map((robot) => <Card key={robot.id}>
      <CardHeader><CardTitle className="flex items-center gap-2">{robot.name}<Badge variant={robot.enabled ? 'outline' : 'secondary'}>{robot.enabled ? '已启用' : '已停用'}</Badge></CardTitle>
        <CardDescription>Webhook：{robot.hasWebhookUrl ? '已配置' : '未配置'} · Secret：{robot.hasSecret ? '已配置' : '未配置'} · 仓库 {robot.repositoryCount} 个 · RSS {robot.rssSubscriptionCount} 个</CardDescription></CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={Boolean(action.pending)} onClick={() => { setEditing(robot); setForm({ name: robot.name, webhookUrl: '', secret: '', enabled: robot.enabled }); setOpen(true); }}><PencilIcon />编辑</Button>
        <Button variant="outline" size="sm" disabled={Boolean(action.pending)} onClick={() => action.execute(robot.id, () => api(`/api/settings/dingtalk/${robot.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !robot.enabled }) }).then(resource.reload))}>{robot.enabled ? '停用' : '启用'}</Button>
        <Button variant="ghost" size="sm" disabled={Boolean(action.pending)} onClick={() => remove(robot)}><Trash2Icon />删除</Button>
      </CardContent>
    </Card>)}
    <Modal open={open} title={editing ? '编辑钉钉机器人' : '添加钉钉机器人'} onClose={() => !action.pending && setOpen(false)} maxWidth="sm:max-w-lg">
      <form className="flex flex-col gap-6" onSubmit={(event) => { event.preventDefault(); save(); }}>
        <ActionError error={action.error} />
        <FieldGroup>
          <Field label="机器人名称"><Input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></Field>
          <SecretField label="Webhook URL" value={form.webhookUrl} required={!editing?.hasWebhookUrl} configured={editing?.hasWebhookUrl} onChange={(value) => setForm((current) => ({ ...current, webhookUrl: value ?? '' }))} />
          <SecretField label="签名 Secret" value={form.secret} configured={editing?.hasSecret} clearable onChange={(value) => setForm((current) => ({ ...current, secret: value }))} />
          <Checkbox label="启用机器人" checked={form.enabled} onChange={(enabled) => setForm((current) => ({ ...current, enabled }))} />
        </FieldGroup>
        <div className="flex justify-end gap-2"><Button variant="outline" disabled={Boolean(action.pending)} onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={Boolean(action.pending)}>{action.pending ? '正在保存…' : '保存配置'}</Button></div>
      </form>
    </Modal>
    {confirmation.element}
  </div>;
}

export function Connections() {
  return <><ShellHeader title="连接器" meta="GitLab 访问凭证与钉钉通知" /><div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7"><Tabs defaultValue="gitlab"><TabsList variant="line"><TabsTrigger value="gitlab">GitLab</TabsTrigger><TabsTrigger value="dingtalk">钉钉</TabsTrigger></TabsList><TabsContent value="gitlab" className="pt-6"><GitLabPanel /></TabsContent><TabsContent value="dingtalk" className="pt-6"><NotificationPanel /></TabsContent></Tabs></div></>;
}
