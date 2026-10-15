import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Field, Input } from '../ui/forms';
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
    <Card className="gap-4 px-5 py-4">
      <h2 className="text-base font-medium">添加 GitLab 账号</h2>
      <Field label="实例地址">
        <Input value={url} onChange={(event) => onUrlChange(event.target.value)} placeholder="https://gitlab.com" />
      </Field>
      <Field label="访问令牌（Personal Access Token）" hint="需 api 权限，用于拉取 diff、发布评论">
        <Input
          type="password"
          value={accessToken}
          onChange={(event) => onAccessTokenChange(event.target.value)}
          placeholder="glpat-..."
        />
      </Field>
      <Field label="Webhook 密钥（可选）" hint="与 GitLab 项目 Webhook 的 Secret Token 一致，用于验签">
        <Input type="password" value={webhookSecret} onChange={(event) => onWebhookSecretChange(event.target.value)} />
      </Field>
      <div>
        <Button onClick={onAdd} disabled={saving}>
          {saving ? '保存中…' : '添加'}
        </Button>
      </div>
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
    <div className="space-y-2">
      {accounts.map((account) => (
        <Card key={account.id} className="flex-row items-center gap-3 px-5 py-4 max-md:flex-col max-md:items-stretch">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{account.url}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              令牌 {account.hasAccessToken ? '已配置' : '缺失'} · Webhook 密钥{' '}
              {account.hasWebhookSecret ? '已配置' : '未配置'}
            </p>
          </div>
          <div className="flex shrink-0 gap-2 border-l pl-4 max-md:border-l-0 max-md:border-t max-md:pt-3 max-md:pl-0">
            <Button variant="outline" onClick={() => onTest(account.id)}>
              测试连接
            </Button>
            <Button variant="destructive" onClick={() => onRemove(account)}>
              删除
            </Button>
          </div>
        </Card>
      ))}
      {accounts.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">还没有 GitLab 账号</p>
      ) : null}
    </div>
  );
}
