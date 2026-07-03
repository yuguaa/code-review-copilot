import { Button, Card, Field, Input } from '../ui';
import type { Account } from '../../hooks/useSettingsPageData';

export function GitLabAccountForm({
  url,
  accessToken,
  webhookSecret,
  saving,
  onUrlChange,
  onAccessTokenChange,
  onWebhookSecretChange,
  onAdd,
}: {
  url: string;
  accessToken: string;
  webhookSecret: string;
  saving: boolean;
  onUrlChange: (value: string) => void;
  onAccessTokenChange: (value: string) => void;
  onWebhookSecretChange: (value: string) => void;
  onAdd: () => void;
}) {
  return (
    <Card className="space-y-4">
      <h2 className="font-display text-lg text-[var(--ink)]">添加 GitLab 账号</h2>
      <Field label="实例地址">
        <Input value={url} onChange={(event) => onUrlChange(event.target.value)} placeholder="https://gitlab.com" />
      </Field>
      <Field label="访问令牌 (Personal Access Token)" hint="需 api 权限，用于拉取 diff、发布评论">
        <Input type="password" value={accessToken} onChange={(event) => onAccessTokenChange(event.target.value)} placeholder="glpat-..." />
      </Field>
      <Field label="Webhook 密钥（可选）" hint="与 GitLab 项目 Webhook 的 Secret Token 一致，用于验签">
        <Input type="password" value={webhookSecret} onChange={(event) => onWebhookSecretChange(event.target.value)} />
      </Field>
      <Button onClick={onAdd} disabled={saving}>
        {saving ? '保存中…' : '添加'}
      </Button>
    </Card>
  );
}

export function GitLabAccountList({
  accounts,
  onTest,
  onRemove,
}: {
  accounts: Account[];
  onTest: (id: string) => void;
  onRemove: (account: Account) => void;
}) {
  return (
    <div className="space-y-3">
      {accounts.map((account) => (
        <Card key={account.id} className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-[var(--ink)]">{account.url}</p>
            <p className="text-[11px] text-[var(--muted)]">
              令牌 {account.hasAccessToken ? '已配置' : '缺失'} · Webhook 密钥 {account.hasWebhookSecret ? '已配置' : '未配置'}
            </p>
          </div>
          <Button variant="secondary" onClick={() => onTest(account.id)}>
            测试连接
          </Button>
          <Button variant="danger" onClick={() => onRemove(account)}>
            删除
          </Button>
        </Card>
      ))}
      {accounts.length === 0 && <p className="text-center text-xs text-[var(--muted)]">还没有 GitLab 账号</p>}
    </div>
  );
}
