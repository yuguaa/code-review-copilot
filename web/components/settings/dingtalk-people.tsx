import { useState } from 'react';

import { ActionError, ResourceState } from '@web/components/common/resource-state';
import { Button } from '@web/components/ui/button';
import { Checkbox, Field, FieldGroup, Input, Select } from '@web/components/ui/forms';
import { useAction, useResource } from '@web/hooks/use-resource';
import { api } from '@web/lib/api';

import type { DingtalkPerson } from '@shared/dingtalk';
import type { DingtalkContact } from '@web/lib/types';

export function DingtalkPeople({ connectionId, selected, onSelect }: {
  connectionId: string; selected?: string[]; onSelect?: (ids: string[]) => void;
}) {
  const resource = useResource<{ contacts: DingtalkContact[] }>(`/api/settings/dingtalk/${connectionId}/contacts`);
  const action = useAction();
  const [query, setQuery] = useState('');
  const [dimension, setDimension] = useState<'name' | 'jobNumber'>('jobNumber');
  const [result, setResult] = useState<{ query: string; dimension: 'name' | 'jobNumber'; people: DingtalkPerson[]; returnedCount: number } | null>(null);
  const search = () => action.execute('search', () => api<{ people: DingtalkPerson[]; returnedCount: number }>(`/api/settings/dingtalk/${connectionId}/people/search`, {
    method: 'POST', body: JSON.stringify({ query: query.trim(), dimension }),
  }).then((next) => setResult({ ...next, query: query.trim(), dimension })));
  return <div className="flex flex-col gap-4">
    <ActionError error={action.error} />
    <FieldGroup>
      <Field label="查找钉钉用户" hint="工号只用于查找，不会当作钉钉 userId；有多个候选时请明确选择。">
        <div className="flex flex-wrap gap-2">
          <Select aria-label="查找方式" className="w-24" value={dimension} disabled={Boolean(action.pending)} onChange={(event) => { setDimension(event.target.value as typeof dimension); setResult(null); }}><option value="jobNumber">工号</option><option value="name">姓名</option></Select>
          <Input className="min-w-32 flex-1" value={query} aria-label="钉钉工号或姓名" onChange={(event) => setQuery(event.target.value)} />
          <Button type="button" variant="outline" disabled={!query.trim() || Boolean(action.pending)} onClick={search}>{action.pending === 'search' ? '查询中…' : '查询通讯录'}</Button>
        </div>
      </Field>
    </FieldGroup>
    {result && <div className="flex flex-col gap-2 rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">本次返回 {result.returnedCount} 位候选，不代表完整通讯录。</p>
      {result.people.map((person) => <div className="flex items-center justify-between gap-3" key={person.userId}>
        <span className="text-sm">{person.name}<span className="ml-2 font-mono text-xs text-muted-foreground">{person.userId}</span></span>
        <Button type="button" size="sm" variant="outline" disabled={Boolean(action.pending)} onClick={() => action.execute(person.userId, () => api<{ contact: DingtalkContact }>(`/api/settings/dingtalk/${connectionId}/contacts`, {
          method: 'POST', body: JSON.stringify({ query: result.query, dimension: result.dimension, userId: person.userId }),
        }).then((body) => { if (onSelect) onSelect([body.contact.id]); return resource.reload(); }))}>{onSelect ? '选择此人' : '保存解析结果'}</Button>
      </div>)}
    </div>}
    <ResourceState loading={resource.loading && !resource.data} error={resource.error} empty={resource.data?.contacts.length === 0} title="请查询收件人" description="按工号或姓名搜索钉钉通讯录，核对后选择一个收件人，无需事先维护名单。" retry={resource.reload} />
    {resource.data?.contacts.filter((contact) => !onSelect || contact.enabled).map((contact) => <div key={contact.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      {onSelect ? <Checkbox label={`${contact.name}${contact.employeeNo ? ` · ${contact.employeeNo}` : ''}${contact.enabled ? '' : '（已停用）'}`}
        checked={selected?.includes(contact.id) ?? false}
        onChange={(checked) => onSelect(checked ? [...(selected ?? []), contact.id] : (selected ?? []).filter((id) => id !== contact.id))} />
        : <span className="text-sm">{contact.name} · {contact.employeeNo || '未绑定工号'}</span>}
      {!onSelect && <Button type="button" variant="ghost" size="sm" disabled={Boolean(action.pending)} onClick={() => action.execute(contact.id, () => api(`/api/settings/dingtalk/${connectionId}/contacts/${contact.id}`, {
        method: 'PATCH', body: JSON.stringify({ enabled: !contact.enabled }),
      }).then(resource.reload))}>{contact.enabled ? '停用' : '启用'}</Button>}
    </div>)}
  </div>;
}
