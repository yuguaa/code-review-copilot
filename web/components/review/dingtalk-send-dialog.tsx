import { useState } from 'react';
import { toast } from 'sonner';

import { ActionError, ResourceState } from '@web/components/common/resource-state';
import { DingtalkPeople } from '@web/components/settings/dingtalk-people';
import { Button } from '@web/components/ui/button';
import { useConfirm } from '@web/components/ui/confirm-dialog';
import { Field, FieldGroup, Input, Textarea } from '@web/components/ui/forms';
import { Modal } from '@web/components/ui/modal';
import { useAction, useResource } from '@web/hooks/use-resource';
import { api } from '@web/lib/api';

import type { DingtalkMessage } from '@web/lib/types';
import type { DingtalkGlobalState, DingtalkMessageDraft } from '@shared/dingtalk';

const statusLabels = { sending: '发送中或待核对', accepted: '钉钉已接受', failed: '发送失败', unknown: '结果未知，请先核对钉钉' } as const;

export function DingtalkSendDialog({ sessionId, initialText, draft, close }: {
  sessionId: string; initialText: string; draft?: DingtalkMessageDraft; close: () => void;
}) {
  const connection = useResource<DingtalkGlobalState>('/api/settings/dingtalk/cli');
  const history = useResource<{ messages: DingtalkMessage[] }>(`/api/sessions/${sessionId}/dingtalk-messages`);
  const connectionId = connection.data?.connection.id ?? '';
  const targetKind = 'direct';
  const profile = draft?.profile ?? connection.data?.auth.profile;
  const [contactIds, setContactIds] = useState<string[]>(draft?.contactIds ?? []);
  const [title, setTitle] = useState(draft?.title ?? '代码审查讨论');
  const [text, setText] = useState(draft?.text ?? initialText);
  const [requestId] = useState(() => crypto.randomUUID());
  const [receipt, setReceipt] = useState<DingtalkMessage | null>(null);
  const action = useAction();
  const confirmation = useConfirm();
  const available = Boolean(connection.data?.connection.enabled && connection.data.auth.authenticated && connection.data.auth.tokenValid && connection.data.auth.profile);
  const stale = Boolean(draft?.profile && connection.data?.auth.profile !== draft.profile);
  const send = () => {
    void confirmation.confirm({ title: '确认发送到钉钉',
      description: `将以当前登录的钉钉身份「${connection.data?.auth.userName}」私聊发送给已选择的收件人。请核对收件人和正文；发送内容可能包含代码。`,
    }).then((approved) => {
      if (!approved) return;
      action.execute('send', () => api<{ message: DingtalkMessage }>(`/api/sessions/${sessionId}/dingtalk-messages`, { method: 'POST',
        body: JSON.stringify({ requestId, connectionId, profile, contactIds, targetKind, title, text, confirmed: true }),
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
      <ResourceState loading={connection.loading && !connection.data} error={connection.error} empty={Boolean(connection.data && !available)}
        title={connection.data?.connection.enabled === false ? '共享 CLI 已停用' : '共享 CLI 尚未登录'} description="请先在连接器中启用共享 CLI，并扫码登录授权。" retry={connection.reload} />
      {stale && <ActionError error="登录身份已变化，请关闭此草稿并重新选择收件人。" />}
      <FieldGroup>
        <p className="text-sm">平台共享 CLI · {connection.data?.auth.corpName} / {connection.data?.auth.userName} · 私聊发送</p>
        {available && !locked && !stale && <DingtalkPeople key={connectionId} connectionId={connectionId} selected={contactIds} onSelect={(ids) => setContactIds(ids.slice(-1))} />}
        <Field label="标题"><Input required maxLength={200} disabled={locked} value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
        <Field label="发送正文" hint="这里只发送到钉钉，不会作为问题提交给 AI；正文会保存到平台发送记录。"><Textarea required className="min-h-40" disabled={locked} maxLength={60_000} value={text} onChange={(event) => setText(event.target.value)} /></Field>
      </FieldGroup>
      {receipt && <p role="status" className="text-sm">{statusLabels[receipt.status]}{receipt.error ? `：${receipt.error}` : ''}</p>}
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={Boolean(action.pending)} onClick={close}>关闭</Button><Button disabled={!available || stale || !title.trim() || !text.trim() || locked || contactIds.length !== 1} onClick={send}>{action.pending ? '发送中…' : '确认收件人并发送'}</Button></div>
      {history.data?.messages.length ? <section className="flex flex-col gap-2"><h3 className="text-sm font-medium">本会话最近发送记录</h3>{history.data.messages.map((message) => <div key={message.id} className="rounded-lg border p-3 text-xs leading-6">
        <p>{message.title} · {statusLabels[message.status]}</p><p className="text-muted-foreground">{message.targetKind === 'group' ? '群消息' : '机器人私聊'} · {message.recipients.map((person) => person.name).join('、') || '未 @ 人员'} · {new Date(message.createdAt).toLocaleString('zh-CN')}</p>
      </div>)}</section> : null}
      <ActionError error={history.error} />
    </div>{confirmation.element}
  </Modal>;
}
