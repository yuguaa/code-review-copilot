import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { SecretField } from '@web/components/common/configuration-form';
import { ActionError } from '@web/components/common/resource-state';
import { Button } from '@web/components/ui/button';
import { Checkbox, Field, FieldGroup, Input } from '@web/components/ui/forms';
import { Modal } from '@web/components/ui/modal';
import { useAction } from '@web/hooks/use-resource';
import { api } from '@web/lib/api';

import type { SecurityIdentity } from '@web/lib/types';

const emptyForm = { name: '', role: 'user', username: '', password: '', isActive: true };

export function IdentityEditor({
  open,
  targetId,
  identity,
  onClose,
  onSaved,
}: {
  open: boolean;
  targetId: string;
  identity: SecurityIdentity | null;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const [form, setForm] = useState(emptyForm);
  const action = useAction();
  useEffect(() => {
    if (!open) return;
    setForm(identity
      ? { name: identity.name, role: identity.role, username: identity.username, password: '', isActive: identity.isActive }
      : emptyForm);
  }, [open, identity]);

  const update = <K extends keyof typeof form>(key: K, value: typeof form[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };
  const save = () => action.execute('save', () => {
    if (!identity && !form.password) throw new Error('请填写测试账号密码');
    const body = {
      name: form.name,
      role: form.role,
      username: form.username,
      isActive: form.isActive,
      ...(form.password ? { password: form.password } : {}),
    };
    return api(identity
      ? `/api/security/identities/${identity.id}`
      : `/api/security/targets/${targetId}/identities`, {
      method: identity ? 'PATCH' : 'POST',
      body: JSON.stringify(body),
    }).then(() => {
      toast.success('测试身份已保存');
      return onSaved();
    }).then(onClose);
  });

  return <Modal open={open} title={identity ? '编辑测试身份' : '添加测试身份'} onClose={() => !action.pending && onClose()} maxWidth="sm:max-w-lg">
    <form className="flex flex-col gap-6" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <ActionError error={action.error} />
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="身份名称"><Input required value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="普通用户 A" /></Field>
          <Field label="角色"><Input required value={form.role} onChange={(event) => update('role', event.target.value)} placeholder="user / admin" /></Field>
        </div>
        <Field label="登录账号"><Input required autoComplete="off" value={form.username} onChange={(event) => update('username', event.target.value)} /></Field>
        <SecretField
          label="登录密码"
          value={form.password}
          configured={identity?.hasPassword}
          required={!identity?.hasPassword}
          onChange={(value) => update('password', value ?? '')}
        />
        <p className="text-xs leading-6 text-muted-foreground">凭据使用 AES-256-GCM 加密保存，接口不会返回密码或密文。</p>
        <Checkbox label="启用身份" checked={form.isActive} onChange={(value) => update('isActive', value)} />
      </FieldGroup>
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={Boolean(action.pending)} onClick={onClose}>取消</Button>
        <Button type="submit" disabled={Boolean(action.pending)}>{action.pending === 'save' ? '正在保存…' : '保存身份'}</Button>
      </div>
    </form>
  </Modal>;
}
