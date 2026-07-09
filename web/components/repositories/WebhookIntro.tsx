import { Button } from '../ui/button';
import { ColorBlock } from '../ui/surface';

export function WebhookIntro({ webhookUrl, onAdd }: { webhookUrl: string; onAdd: () => void }) {
  return (
    <ColorBlock tone="pink" className="space-y-4 p-5">
      <div className="flex items-start justify-between gap-3 max-sm:flex-col">
        <div className="space-y-1">
          <h2 className="font-display text-lg">Webhook 接入</h2>
          <p className="text-sm opacity-80">在 GitLab 项目里添加 Webhook，勾选 Merge Request events 和 Push events。</p>
        </div>
        <Button onClick={onAdd} type="button">
          添加仓库
        </Button>
      </div>
      <code className="block break-all rounded-[var(--r-sm)] border border-[var(--line-invert)] bg-[var(--surface-dark)] px-3 py-2.5 font-mono text-xs text-[var(--brand-cyan)]">{webhookUrl}</code>
      <p className="border-t border-[var(--line-default)] pt-3 text-xs opacity-70">Secret Token 与对应账号的 Webhook 密钥一致即可验签。</p>
    </ColorBlock>
  );
}
