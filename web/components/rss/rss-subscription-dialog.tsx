import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@web/lib/api';
import type { RssSubscriptionItem } from '@web/lib/types';
import { Button } from '@web/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@web/components/ui/dialog';
import { Input } from '@web/components/ui/input';
import { Label } from '@web/components/ui/label';
import { Switch } from '@web/components/ui/switch';

type RssForm = {
  name: string;
  url: string;
  intervalMinutes: string;
  enabled: boolean;
};

const EMPTY_FORM: RssForm = { name: '', url: '', intervalMinutes: '30', enabled: true };

/** 订阅表单：新增与编辑共用，提交后由调用方刷新列表。 */
export function RssSubscriptionDialog({
  open,
  subscription,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  subscription: RssSubscriptionItem | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<RssForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      subscription
        ? {
            name: subscription.name,
            url: subscription.url,
            intervalMinutes: String(subscription.intervalMinutes),
            enabled: subscription.enabled,
          }
        : EMPTY_FORM,
    );
  }, [open, subscription]);

  const save = () => {
    setSaving(true);
    const body = JSON.stringify({
      name: form.name.trim(),
      url: form.url.trim(),
      intervalMinutes: Number(form.intervalMinutes),
      enabled: form.enabled,
    });
    const request = subscription
      ? api(`/api/rss/subscriptions/${subscription.id}`, { method: 'PATCH', body })
      : api('/api/rss/subscriptions', { method: 'POST', body });

    request
      .then(() => {
        toast.success(subscription ? '订阅已更新' : '订阅已创建');
        onOpenChange(false);
        onSaved();
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : '保存失败'))
      .finally(() => setSaving(false));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{subscription ? '编辑订阅' : '新增订阅'}</DialogTitle>
          <DialogDescription>抓取到的新条目会推送到全局钉钉机器人。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rss-name">订阅名称</Label>
            <Input
              id="rss-name"
              value={form.name}
              placeholder="例如：前端周刊"
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rss-url">Feed 地址</Label>
            <Input
              id="rss-url"
              value={form.url}
              placeholder="https://example.com/feed.xml"
              onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rss-interval">抓取间隔（分钟）</Label>
            <Input
              id="rss-interval"
              type="number"
              min={5}
              max={1440}
              value={form.intervalMinutes}
              onChange={(event) => setForm((current) => ({ ...current, intervalMinutes: event.target.value }))}
            />
            <p className="text-xs text-muted-foreground">取值 5 到 1440，调度器每分钟检查一次是否到期。</p>
          </div>
          <div className="flex items-center justify-between rounded-lg border px-3 py-2">
            <span className="text-sm">启用推送</span>
            <Switch
              checked={form.enabled}
              onCheckedChange={(checked) => setForm((current) => ({ ...current, enabled: checked }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button type="button" onClick={save} disabled={saving || !form.name.trim() || !form.url.trim()}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
