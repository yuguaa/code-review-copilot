import { Button } from '../ui/button';
import { Card } from '../ui/card';

export function WebhookIntro({ webhookUrl, onAdd }: { webhookUrl: string; onAdd: () => void }) {
  return (
    <Card className="gap-4 px-5 py-4">
      <div className="flex items-start justify-between gap-3 max-sm:flex-col">
        <div className="space-y-1">
          <h2 className="text-base font-medium">Webhook 接入</h2>
          <p className="text-sm text-muted-foreground">
            在 GitLab 项目里添加 Webhook，勾选 Merge Request events 和 Push events。
          </p>
        </div>
        <Button onClick={onAdd} type="button" variant="secondary">
          添加仓库
        </Button>
      </div>
      <code className="block break-all rounded-md bg-muted px-3 py-2.5 font-mono text-xs">{webhookUrl}</code>
      <p className="border-t pt-3 text-xs text-muted-foreground">Secret Token 与对应账号的 Webhook 密钥一致即可验签。</p>
    </Card>
  );
}
