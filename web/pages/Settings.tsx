import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { Button, Card, Field, Input, PageShell } from '../components/ui';

type Account = {
  id: string;
  url: string;
  isActive: boolean;
  hasAccessToken: boolean;
  hasWebhookSecret: boolean;
};

export function Settings() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [url, setUrl] = useState('https://gitlab.com');
  const [accessToken, setAccessToken] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const d = await api<{ accounts: Account[] }>('/api/settings/gitlab').catch(() => ({ accounts: [] }));
    setAccounts(d.accounts);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!url || !accessToken) return toast.error('请填写实例地址与访问令牌');
    setSaving(true);
    try {
      await api('/api/settings/gitlab', {
        method: 'POST',
        body: JSON.stringify({ url, accessToken, webhookSecret: webhookSecret || null }),
      });
      setAccessToken('');
      setWebhookSecret('');
      await load();
      toast.success('已添加 GitLab 账号');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '添加失败');
    } finally {
      setSaving(false);
    }
  };

  const test = async (id: string) => {
    const d = await api<{ ok: boolean }>(`/api/settings/gitlab/${id}/test`, { method: 'POST' }).catch(() => ({ ok: false }));
    d.ok ? toast.success('连接正常') : toast.error('连接失败，请检查地址与令牌');
  };

  const remove = async (id: string) => {
    await api(`/api/settings/gitlab/${id}`, { method: 'DELETE' });
    await load();
  };

  return (
    <PageShell title="设置 · GitLab 账号">
      <Card className="space-y-4">
        <h2 className="text-sm font-semibold">添加 GitLab 账号</h2>
        <Field label="实例地址">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://gitlab.com" />
        </Field>
        <Field label="访问令牌 (Personal Access Token)" hint="需 api 权限，用于拉取 diff、发布评论">
          <Input type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder="glpat-..." />
        </Field>
        <Field label="Webhook 密钥（可选）" hint="与 GitLab 项目 Webhook 的 Secret Token 一致，用于验签">
          <Input type="password" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} />
        </Field>
        <Button onClick={add} disabled={saving}>
          {saving ? '保存中…' : '添加'}
        </Button>
      </Card>

      <div className="space-y-3">
        {accounts.map((a) => (
          <Card key={a.id} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-neutral-200">{a.url}</p>
              <p className="text-[11px] text-neutral-500">
                令牌 {a.hasAccessToken ? '已配置' : '缺失'} · Webhook 密钥 {a.hasWebhookSecret ? '已配置' : '未配置'}
              </p>
            </div>
            <Button variant="ghost" onClick={() => test(a.id)}>
              测试连接
            </Button>
            <Button variant="danger" onClick={() => remove(a.id)}>
              删除
            </Button>
          </Card>
        ))}
        {accounts.length === 0 && <p className="text-center text-xs text-neutral-600">还没有 GitLab 账号</p>}
      </div>
    </PageShell>
  );
}
