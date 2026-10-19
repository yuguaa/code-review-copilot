import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ActionError } from '@web/components/common/resource-state';
import { Button } from '@web/components/ui/button';
import { Checkbox, Field, FieldGroup, Input, Select, Textarea } from '@web/components/ui/forms';
import { Modal } from '@web/components/ui/modal';
import { useAction } from '@web/hooks/use-resource';
import { api } from '@web/lib/api';

import type { AIModelSummary, DingtalkRobot, RepositoryItem, SecurityTarget } from '@web/lib/types';

type TargetForm = {
  name: string;
  baseUrl: string;
  repositoryId: string;
  scopeDomains: string;
  authorizationOwner: string;
  authorizationReference: string;
  authorizedUntil: string;
  scheduleEnabled: boolean;
  scheduleIntervalMinutes: number;
  isActive: boolean;
  maxDurationMinutes: number;
  defaultAIModelId: string;
  dingtalkRobotId: string;
};

const emptyForm: TargetForm = {
  name: '',
  baseUrl: '',
  repositoryId: '',
  scopeDomains: '',
  authorizationOwner: '',
  authorizationReference: '',
  authorizedUntil: '',
  scheduleEnabled: false,
  scheduleIntervalMinutes: 1440,
  isActive: true,
  maxDurationMinutes: 30,
  defaultAIModelId: '',
  dingtalkRobotId: '',
};

function localDateTime(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formOf(target: SecurityTarget | null): TargetForm {
  if (!target) return emptyForm;
  return {
    name: target.name,
    baseUrl: target.baseUrl,
    repositoryId: target.repositoryId ?? '',
    scopeDomains: target.scopeDomains.join('\n'),
    authorizationOwner: target.authorizationOwner,
    authorizationReference: target.authorizationReference,
    authorizedUntil: localDateTime(target.authorizedUntil),
    scheduleEnabled: target.scheduleEnabled,
    scheduleIntervalMinutes: target.scheduleIntervalMinutes,
    isActive: target.isActive,
    maxDurationMinutes: target.maxDurationMinutes,
    defaultAIModelId: target.defaultAIModelId ?? '',
    dingtalkRobotId: target.dingtalkRobotId ?? '',
  };
}

function scopeDomainsOf(value: string) {
  return [...new Set(value.split(/[\n,]/).map((domain) => domain.trim()).filter(Boolean))];
}

export function TargetEditor({
  open,
  target,
  repositories,
  models,
  robots,
  onClose,
  onSaved,
}: {
  open: boolean;
  target: SecurityTarget | null;
  repositories: RepositoryItem[];
  models: AIModelSummary[];
  robots: DingtalkRobot[];
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const [form, setForm] = useState<TargetForm>(emptyForm);
  const action = useAction();
  useEffect(() => {
    if (open) setForm(formOf(target));
  }, [open, target]);

  const update = <K extends keyof TargetForm>(key: K, value: TargetForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };
  const save = () => action.execute('save', () => {
    const domains = scopeDomainsOf(form.scopeDomains);
    if (!domains.length) throw new Error('请填写至少一个授权域名');
    return api(target ? `/api/security/targets/${target.id}` : '/api/security/targets', {
      method: target ? 'PATCH' : 'POST',
      body: JSON.stringify({
        name: form.name,
        baseUrl: form.baseUrl,
        repositoryId: form.repositoryId || null,
        scopeDomains: domains,
        authorizationOwner: form.authorizationOwner,
        authorizationReference: form.authorizationReference,
        authorizedUntil: new Date(form.authorizedUntil).toISOString(),
        scheduleEnabled: form.scheduleEnabled,
        scheduleIntervalMinutes: form.scheduleIntervalMinutes,
        isActive: form.isActive,
        maxDurationMinutes: form.maxDurationMinutes,
        defaultAIModelId: form.defaultAIModelId || null,
        dingtalkRobotId: form.dingtalkRobotId || null,
      }),
    }).then(() => {
      toast.success('安全测试目标已保存');
      return onSaved();
    }).then(onClose);
  });

  return <Modal open={open} title={target ? '编辑测试目标' : '新增测试目标'} onClose={() => !action.pending && onClose()} maxWidth="sm:max-w-2xl">
    <form className="flex flex-col gap-6" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <ActionError error={action.error} />
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="目标名称"><Input required value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="面向用户的业务系统" /></Field>
          <Field label="目标地址"><Input type="url" required value={form.baseUrl} onChange={(event) => update('baseUrl', event.target.value)} placeholder="https://app.example.com" /></Field>
        </div>
        <Field label="授权范围" hint="每行一个完整域名；子域名需要分别填写，不会允许范围外地址。">
          <Textarea required rows={4} value={form.scopeDomains} onChange={(event) => update('scopeDomains', event.target.value)} placeholder={'app.example.com\napi.example.com'} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="关联仓库" hint="用于关联代码来源，可留空。">
            <Select value={form.repositoryId} onChange={(event) => update('repositoryId', event.target.value)}>
              <option value="">不关联仓库</option>
              {repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.path}</option>)}
            </Select>
          </Field>
          <Field label="授权截止时间"><Input type="datetime-local" required value={form.authorizedUntil} onChange={(event) => update('authorizedUntil', event.target.value)} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="授权人"><Input required value={form.authorizationOwner} onChange={(event) => update('authorizationOwner', event.target.value)} /></Field>
          <Field label="授权依据"><Input required value={form.authorizationReference} onChange={(event) => update('authorizationReference', event.target.value)} placeholder="工单号、邮件或合同编号" /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="默认模型" hint="留空时使用全局默认模型。">
            <Select value={form.defaultAIModelId} onChange={(event) => update('defaultAIModelId', event.target.value)}>
              <option value="">使用全局默认模型</option>
              {models.filter((model) => model.isActive).map((model) => <option key={model.id} value={model.id}>{model.provider} / {model.modelId}</option>)}
            </Select>
          </Field>
          <Field label="钉钉机器人" hint="完成后发送摘要。">
            <Select value={form.dingtalkRobotId} onChange={(event) => update('dingtalkRobotId', event.target.value)}>
              <option value="">不发送通知</option>
              {robots.filter((robot) => robot.enabled && robot.hasWebhookUrl).map((robot) => <option key={robot.id} value={robot.id}>{robot.name}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="单次执行上限（分钟）"><Input type="number" min={1} max={1440} required value={form.maxDurationMinutes} onChange={(event) => update('maxDurationMinutes', Number(event.target.value))} /></Field>
          <Field label="自动执行周期（分钟）" hint="最小 5 分钟；启用计划后生效。">
            <Input type="number" min={5} max={525600} required value={form.scheduleIntervalMinutes} onChange={(event) => update('scheduleIntervalMinutes', Number(event.target.value))} />
          </Field>
        </div>
        <Checkbox label="启用自动安全测试" checked={form.scheduleEnabled} onChange={(value) => update('scheduleEnabled', value)} />
        <Checkbox label="启用目标" checked={form.isActive} onChange={(value) => update('isActive', value)} />
      </FieldGroup>
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={Boolean(action.pending)} onClick={onClose}>取消</Button>
        <Button type="submit" disabled={Boolean(action.pending)}>{action.pending === 'save' ? '正在保存…' : '保存目标'}</Button>
      </div>
    </form>
  </Modal>;
}
