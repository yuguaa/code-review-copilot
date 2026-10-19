import { useState } from 'react';
import { BlocksIcon, CircleCheckIcon, PencilIcon, PlusIcon, Trash2Icon, ZapIcon } from 'lucide-react';
import { toast } from 'sonner';

import { SecretField } from '@web/components/common/configuration-form';
import { ActionError, ResourceState } from '@web/components/common/resource-state';
import { ShellHeader } from '@web/components/layout/shell-header';
import { Badge } from '@web/components/ui/badge';
import { Button } from '@web/components/ui/button';
import { useConfirm } from '@web/components/ui/confirm-dialog';
import { Checkbox, Field, FieldGroup, Input, Select } from '@web/components/ui/forms';
import { Modal } from '@web/components/ui/modal';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@web/components/ui/table';
import { useAction, useResource } from '@web/hooks/use-resource';
import { api } from '@web/lib/api';

import type { AIModelSummary } from '@web/lib/types';

const emptyForm = { provider: 'openai', modelId: '', apiBaseUrl: '', apiKey: '', maxSteps: 16, isDefault: false, isActive: true };

export function Models() {
  const resource = useResource<{ models: AIModelSummary[] }>('/api/settings/models');
  const [editing, setEditing] = useState<AIModelSummary | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const action = useAction();
  const confirmation = useConfirm();
  const update = <K extends keyof typeof form>(key: K, value: typeof form[K]) => setForm((current) => ({ ...current, [key]: value }));
  const edit = (model: AIModelSummary) => {
    setEditing(model);
    setForm({ provider: model.provider, modelId: model.modelId, apiBaseUrl: model.apiBaseUrl ?? '', apiKey: '', maxSteps: model.maxSteps, isDefault: model.isDefault, isActive: model.isActive });
    setOpen(true);
  };
  const save = () => action.execute('save', () => api(editing ? `/api/settings/models/${editing.id}` : '/api/settings/models', {
    method: editing ? 'PATCH' : 'POST', body: JSON.stringify({ ...form, apiBaseUrl: form.apiBaseUrl.trim() || null }),
  }).then(() => { setOpen(false); toast.success('模型配置已保存'); return resource.reload(); }));
  const remove = (model: AIModelSummary) => {
    void confirmation.confirm({ title: '删除模型配置', description: `确认删除 ${model.provider}/${model.modelId}？仍被仓库使用的模型由服务端检查。` }).then((approved) => {
      if (approved) action.execute(model.id, () => api(`/api/settings/models/${model.id}`, { method: 'DELETE' }).then(resource.reload));
    });
  };
  const test = (model: AIModelSummary) => action.execute(model.id, () => api<{ ok: boolean }>(`/api/settings/models/${model.id}/test`, { method: 'POST' }).then(({ ok }) => {
    ok ? toast.success('模型连接正常') : toast.error('模型连接失败，请检查配置');
  }));

  return <>
    <ShellHeader title="模型" meta="管理 OCR 审查和追问使用的模型"><Button onClick={() => { setEditing(null); setForm({ ...emptyForm, isDefault: resource.data?.models.length === 0 }); setOpen(true); }}><PlusIcon />添加模型</Button></ShellHeader>
    <div className="min-h-0 flex-1 overflow-auto p-5 sm:p-7">
      <ActionError error={action.error} />
      <ResourceState loading={resource.loading && !resource.data} error={resource.error} empty={resource.data?.models.length === 0} title="尚未配置模型" description="添加 Provider、Model ID 和 API Key 后，仓库可以选择对应模型。" retry={resource.reload} />
      {resource.data && resource.data.models.length > 0 && <div className="overflow-hidden rounded-lg border"><Table>
        <TableHeader><TableRow><TableHead>模型</TableHead><TableHead>接口地址</TableHead><TableHead>状态</TableHead><TableHead>凭证</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
        <TableBody>{resource.data.models.map((model) => <TableRow key={model.id}>
          <TableCell><div className="flex items-center gap-3"><BlocksIcon className="size-4 text-muted-foreground" /><div><p className="font-medium">{model.modelId}</p><p className="mt-1 text-xs text-muted-foreground">{model.provider}</p></div>{model.isDefault && <Badge variant="secondary">默认</Badge>}</div></TableCell>
          <TableCell className="max-w-60 truncate text-muted-foreground">{model.apiBaseUrl || 'Provider 默认地址'}</TableCell>
          <TableCell><Badge variant={model.isActive ? 'outline' : 'secondary'}>{model.isActive ? '已启用' : '已停用'}</Badge></TableCell>
          <TableCell className="text-xs text-muted-foreground">{model.hasApiKey ? '已配置' : '未配置'}</TableCell>
          <TableCell><div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" title="测试连接" aria-label={`测试 ${model.modelId}`} disabled={Boolean(action.pending)} onClick={() => test(model)}><ZapIcon /></Button>
            {!model.isDefault && <Button variant="ghost" size="icon" title="设为默认" aria-label={`将 ${model.modelId} 设为默认`} disabled={Boolean(action.pending)} onClick={() => action.execute(model.id, () => api(`/api/settings/models/${model.id}`, { method: 'PATCH', body: JSON.stringify({ isDefault: true }) }).then(resource.reload))}><CircleCheckIcon /></Button>}
            <Button variant="ghost" size="icon" aria-label={`编辑 ${model.modelId}`} onClick={() => edit(model)}><PencilIcon /></Button>
            <Button variant="ghost" size="icon" aria-label={`删除 ${model.modelId}`} disabled={Boolean(action.pending)} onClick={() => remove(model)}><Trash2Icon /></Button>
          </div></TableCell>
        </TableRow>)}</TableBody>
      </Table></div>}
    </div>
    <Modal open={open} title={editing ? '编辑模型' : '添加模型'} onClose={() => !action.pending && setOpen(false)} maxWidth="sm:max-w-lg">
      <form className="flex flex-col gap-6" onSubmit={(event) => { event.preventDefault(); save(); }}>
        <ActionError error={action.error} />
        <FieldGroup>
          <Field label="Provider"><Select value={form.provider} onChange={(event) => update('provider', event.target.value)}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="openai-compatible">OpenAI Compatible</option></Select></Field>
          <Field label="Model ID"><Input required value={form.modelId} onChange={(event) => update('modelId', event.target.value)} placeholder="输入服务商提供的 Model ID" /></Field>
          <Field label="接口地址" hint="官方接口可留空；自定义接口填写完整地址。"><Input type="url" required={form.provider === 'openai-compatible'} value={form.apiBaseUrl} onChange={(event) => update('apiBaseUrl', event.target.value)} placeholder="https://…" /></Field>
          <SecretField label="API Key" value={form.apiKey} configured={editing?.hasApiKey} required={!editing?.hasApiKey} onChange={(value) => update('apiKey', value ?? '')} />
          <Field label="追问最大步骤"><Input type="number" min={1} max={2147483647} required value={form.maxSteps} onChange={(event) => update('maxSteps', Number(event.target.value))} /></Field>
          <Checkbox label="作为默认模型" checked={form.isDefault} onChange={(value) => update('isDefault', value)} />
          <Checkbox label="启用模型" checked={form.isActive} onChange={(value) => update('isActive', value)} />
        </FieldGroup>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)} disabled={Boolean(action.pending)}>取消</Button><Button type="submit" disabled={Boolean(action.pending)}>{action.pending === 'save' ? '正在保存…' : '保存配置'}</Button></div>
      </form>
    </Modal>
    {confirmation.element}
  </>;
}
