import { useEffect, useState } from 'react';
import { PlusIcon, RefreshCwIcon, RssIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@web/lib/api';
import { useRssSubscriptions } from '@web/hooks/useRssSubscriptions';
import type { RssSubscriptionItem } from '@web/lib/types';
import { ShellHeader } from '@web/components/layout/shell-header';
import { Badge } from '@web/components/ui/badge';
import { Button } from '@web/components/ui/button';
import { Card } from '@web/components/ui/card';
import { Switch } from '@web/components/ui/switch';
import { useConfirm } from '@web/components/ui/confirm-dialog';
import { RssSubscriptionDialog } from '@web/components/rss/rss-subscription-dialog';

function formatTime(value: string | null): string {
  if (!value) return '尚未抓取';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

export function Rss() {
  const { subscriptions, loaded, load } = useRssSubscriptions();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RssSubscriptionItem | null>(null);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [dingtalkReady, setDingtalkReady] = useState<boolean | null>(null);
  const { confirm, element: confirmElement } = useConfirm();

  useEffect(() => {
    api<{ notification: { dingtalkEnabled: boolean; dingtalkWebhookUrl: string | null } }>('/api/settings/notification')
      .then((data) =>
        setDingtalkReady(Boolean(data.notification.dingtalkEnabled && data.notification.dingtalkWebhookUrl)),
      )
      .catch((error) => toast.error(error instanceof Error ? error.message : '钉钉配置读取失败'));
  }, []);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (subscription: RssSubscriptionItem) => {
    setEditing(subscription);
    setDialogOpen(true);
  };

  const fetchNow = (subscription: RssSubscriptionItem) => {
    setFetchingId(subscription.id);
    api<{ result: { baseline: number; pushed: number; skipped: number } }>(
      `/api/rss/subscriptions/${subscription.id}/fetch`,
      { method: 'POST' },
    )
      .then(({ result }) => {
        toast.success(
          result.baseline > 0
            ? `首次抓取已建立基线（${result.baseline} 条），后续新内容会推送`
            : `已推送 ${result.pushed} 条，跳过 ${result.skipped} 条`,
        );
        void load();
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : '抓取失败'))
      .finally(() => setFetchingId(null));
  };

  const toggleEnabled = (subscription: RssSubscriptionItem, enabled: boolean) => {
    api(`/api/rss/subscriptions/${subscription.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    })
      .then(() => load())
      .catch((error) => toast.error(error instanceof Error ? error.message : '更新失败'));
  };

  const remove = (subscription: RssSubscriptionItem) => {
    void confirm({
      title: '删除订阅',
      description: `「${subscription.name}」及其推送记录将被删除，之后不再推送新内容。`,
    }).then((approved) => {
      if (!approved) return;
      api(`/api/rss/subscriptions/${subscription.id}`, { method: 'DELETE' })
        .then(() => {
          toast.success('订阅已删除');
          void load();
        })
        .catch((error) => toast.error(error instanceof Error ? error.message : '删除失败'));
    });
  };

  return (
    <>
      <ShellHeader title="RSS 订阅" meta="定时抓取订阅源，新内容推送到全局钉钉机器人">
        <Button type="button" size="sm" onClick={openCreate}>
          <PlusIcon />
          新增订阅
        </Button>
      </ShellHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl space-y-4 p-3 sm:p-4">
          <Card className="gap-2 p-4">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              <RssIcon className="size-4" />
              推送说明
              {dingtalkReady === true ? <Badge variant="secondary">全局钉钉已启用</Badge> : null}
              {dingtalkReady === false ? <Badge variant="destructive">全局钉钉未启用</Badge> : null}
            </p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>· 使用设置页里的全局钉钉机器人，与代码审查通知共用同一个机器人。</li>
              <li>· RSS 使用独立的消息模板，标题以「RSS 更新」开头，正文包含订阅名、发布时间与原文链接。</li>
              <li>· 首次抓取只建立基线，不会把历史条目全部推送。</li>
              <li>· 单次抓取最多推送 5 条，避免长时间停用后一次性刷屏。</li>
            </ul>
            {dingtalkReady === false ? (
              <p className="text-sm text-destructive">
                当前全局钉钉未启用，有新内容时会推送失败。请先到「设置」里保存钉钉机器人 Webhook。
              </p>
            ) : null}
          </Card>

          {!loaded ? (
            <p className="py-10 text-center text-sm text-muted-foreground">加载订阅中…</p>
          ) : subscriptions.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              还没有订阅源。新增之后，调度器会按设置的间隔自动抓取。
            </p>
          ) : (
            <div className="space-y-2">
              {subscriptions.map((subscription) => (
                <Card key={subscription.id} className="gap-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{subscription.name}</span>
                        <Badge variant={subscription.enabled ? 'secondary' : 'outline'}>
                          {subscription.enabled ? '已启用' : '已停用'}
                        </Badge>
                        {subscription.lastError ? <Badge variant="destructive">抓取异常</Badge> : null}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{subscription.url}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Switch
                        checked={subscription.enabled}
                        aria-label="启用推送"
                        onCheckedChange={(checked) => toggleEnabled(subscription, checked)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={fetchingId === subscription.id}
                        onClick={() => fetchNow(subscription)}
                      >
                        <RefreshCwIcon className={fetchingId === subscription.id ? 'animate-spin' : undefined} />
                        立即抓取
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => openEdit(subscription)}>
                        编辑
                      </Button>
                      <Button type="button" variant="destructive" size="icon-sm" onClick={() => remove(subscription)}>
                        <Trash2Icon />
                        <span className="sr-only">删除订阅</span>
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                    <span>间隔：{subscription.intervalMinutes} 分钟</span>
                    <span>最近抓取：{formatTime(subscription.lastFetchedAt)}</span>
                    <span>已记录条目：{subscription.pushedCount}</span>
                  </div>

                  {subscription.lastError ? (
                    <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      {subscription.lastError}
                    </p>
                  ) : null}
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      <RssSubscriptionDialog
        open={dialogOpen}
        subscription={editing}
        onOpenChange={setDialogOpen}
        onSaved={load}
      />
      {confirmElement}
    </>
  );
}
