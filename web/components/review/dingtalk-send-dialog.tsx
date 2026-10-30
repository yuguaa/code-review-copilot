import { useState } from 'react';
import { toast } from 'sonner';

import { ActionError, ResourceState } from '@web/components/common/resource-state';
import { DingtalkPeople } from '@web/components/settings/dingtalk-people';
import { Button } from '@web/components/ui/button';
import { useConfirm } from '@web/components/ui/confirm-dialog';
import { Field, FieldGroup, Input, Select, Textarea } from '@web/components/ui/forms';
import { Modal } from '@web/components/ui/modal';
import { useAction, useResource } from '@web/hooks/use-resource';
import { api } from '@web/lib/api';

import type { DingtalkMessage, DingtalkRobot } from '@web/lib/types';
import type { DingtalkMessageDraft } from '@shared/dingtalk';

const statusLabels = { sending: '发送中或待核对', accepted: '钉钉已接受', failed: '发送失败', unknown: '结果未知，请先核对钉钉' } as const;

export function DingtalkSendDialog({ sessionId, initialText, draft, close }: {
  sessionId: string; initialText: string; draft?: DingtalkMessageDraft; close: () => void;
}) {
  const connections = useResource<{ robots: DingtalkRobot[] }>('/api/settings/dingtalk');
  const history = useResource<{ messages: DingtalkMessage[] }>(`/api/sessions/${sessionId}/dingtalk-messages`);
  const [connectionId, setConnectionId] = useState(draft?.connectionId ?? '');
  const [targetKind, setTargetKind] = useState<'group' | 'direct'>(draft?.targetKind ?? 'group');
  const [contactIds, setContactIds] = useState<string[]>(draft?.contactIds ?? []);
  const [title, setTitle] = useState(draft?.title ?? '代码审查讨论');
  const [text, setText] = useState(draft?.text ?? initialText);
  const [requestId] = useState(() => crypto.randomUUID());
  const [receipt, setReceipt] = useState<DingtalkMessage | null>(null);
  const action = useAction();
  const confirmation = useConfirm();
  const available = connections.data?.robots.filter((robot) => robot.enabled && robot.isConfigured && robot.transport === 'cli') ?? [];
  const connection = available.find((robot) => robot.id === connectionId);
  const send = () => {
    void confirmation.confirm({ title: '确认发送到钉钉',
      description: `将以「${connection?.name}」机器人身份${targetKind === 'group' ? `发送到默认群 ${connection?.cliGroupId}${contactIds.length ? ` 并 @ ${contactIds.length} 人` : ''}` : `私聊发送给已选择的 ${contactIds.length} 人`}。请核对上方名单和正文；发送内容可能包含代码。`,
    }).then((approved) => {
      if (!approved) return;
      action.execute('send', () => api<{ message: DingtalkMessage }>(`/api/sessions/${sessionId}/dingtalk-messages`, { method: 'POST',
        body: JSON.stringify({ requestId, connectionId, contactIds, targetKind, title, text, confirmed: true }),
      }).then(({ message }) => {
        setReceipt(message);
        if (message.status === 'accepted') toast.success('钉钉已接受消息');
        return history.reload();
      }));
    });
  };
  const locked = Boolean(action.pending || receipt);
  return <Modal open title="发送到钉钉" maxWidth="sm:max-w-2xl" onClose={() => !action.pending && close()}>
    <div className="flex flex-col gap-5">
      <ActionError error={action.error} />
      <ResourceState loading={connections.loading && !connections.data} error={connections.error} empty={Boolean(connections.data && !available.length)} title="没有可用的 CLI 连接" description="请先在连接器中添加并授权钉钉 CLI，Webhook 仍用于原有群通知。" retry={connections.reload} />
      <FieldGroup>
        <Field label="钉钉连接"><Select required value={connectionId} disabled={locked} onChange={(event) => { setConnectionId(event.target.value); setContactIds([]); }}><option value="">请选择连接</option>{available.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.cliProfile}</option>)}</Select></Field>
        <Field label="发送方式"><Select value={targetKind} disabled={locked} onChange={(event) => setTargetKind(event.target.value as typeof targetKind)}><option value="group">默认群消息 / @所选人员</option><option value="direct">机器人私聊所选人员</option></Select></Field>
        {connection && !locked && <DingtalkPeople key={connectionId} connectionId={connectionId} selected={contactIds} onSelect={setContactIds} />}
        <Field label="标题"><Input required maxLength={200} disabled={locked} value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
        <Field label="发送正文" hint="这里只发送到钉钉，不会作为问题提交给 AI；正文会保存到平台发送记录。"><Textarea required className="min-h-40" disabled={locked} maxLength={60_000} value={text} onChange={(event) => setText(event.target.value)} /></Field>
      </FieldGroup>
      {receipt && <p role="status" className="text-sm">{statusLabels[receipt.status]}{receipt.error ? `：${receipt.error}` : ''}</p>}
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={Boolean(action.pending)} onClick={close}>关闭</Button><Button disabled={!connection || !title.trim() || !text.trim() || locked || (targetKind === 'direct' && !contactIds.length)} onClick={send}>{action.pending ? '发送中…' : '确认收件人并发送'}</Button></div>
      {history.data?.messages.length ? <section className="flex flex-col gap-2"><h3 className="text-sm font-medium">本会话最近发送记录</h3>{history.data.messages.map((message) => <div key={message.id} className="rounded-lg border p-3 text-xs leading-6">
        <p>{message.title} · {statusLabels[message.status]}</p><p className="text-muted-foreground">{message.targetKind === 'group' ? '群消息' : '机器人私聊'} · {message.recipients.map((person) => person.name).join('、') || '未 @ 人员'} · {new Date(message.createdAt).toLocaleString('zh-CN')}</p>
      </div>)}</section> : null}
      <ActionError error={history.error} />
    </div>{confirmation.element}
  </Modal>;
}
