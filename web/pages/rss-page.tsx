import { useState } from "react";
import { PencilIcon, PlusIcon, RefreshCwIcon, RssIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { ActionError, ResourceState } from "@web/components/common/resource-state";
import { ShellHeader } from "@web/components/layout/shell-header";
import { Badge } from "@web/components/ui/badge";
import { Button } from "@web/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@web/components/ui/card";
import { useConfirm } from "@web/components/ui/confirm-dialog";
import { Checkbox, Field, FieldGroup, Input, Select } from "@web/components/ui/forms";
import { Modal } from "@web/components/ui/modal";
import { ScrollArea } from "@web/components/ui/scroll-area";
import { useAction, useResource } from "@web/hooks/use-resource";
import { api } from "@web/lib/api";
import { formatDate } from "@web/lib/run-format";

import type { DingtalkRobot, RssSubscriptionItem } from "@web/lib/types";

const emptyForm = { name: "", url: "", intervalMinutes: 30, enabled: true, dingtalkRobotId: null as string | null };

export function Rss() {
  const resource = useResource<{ subscriptions: RssSubscriptionItem[] }>("/api/rss/subscriptions");
  const robots = useResource<{ robots: DingtalkRobot[] }>("/api/settings/dingtalk");
  const [editing, setEditing] = useState<RssSubscriptionItem | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const action = useAction();
  const confirmation = useConfirm();
  const selectedRobot = robots.data?.robots.find((robot) => robot.id === form.dingtalkRobotId);
  const robotValid = Boolean(selectedRobot?.enabled && selectedRobot.isConfigured);
  const canEnable = (id: string | null) => Boolean(robots.data?.robots.some((robot) => robot.id === id && robot.enabled && robot.isConfigured));
  const robotLabel = (id: string | null) => {
    if (!id) return "未选择机器人";
    if (!robots.data) return robots.error ? "机器人名单加载失败" : "正在加载机器人…";
    const robot = robots.data.robots.find((item) => item.id === id);
    return robot ? `${robot.name}${!robot.enabled ? "（已停用）" : !robot.isConfigured ? "（配置不完整）" : ""}` : "原关联机器人不可用";
  };
  const remove = (item: RssSubscriptionItem) => {
    void confirmation.confirm({ title: "删除 RSS 订阅", description: `确认删除「${item.name}」？之后停止抓取和发送该订阅。` }).then((approved) => {
      if (approved) action.execute(item.id, () => api(`/api/rss/subscriptions/${item.id}`, { method: "DELETE" }).then(resource.reload));
    });
  };
  const fetchFeed = (item: RssSubscriptionItem) => action.execute(item.id, () => api<{ result: { pushed: number; baseline: number } }>(`/api/rss/subscriptions/${item.id}/fetch`, { method: "POST" })
    .then(({ result }) => {
      toast.success(result.baseline ? `已建立 ${result.baseline} 条历史内容的基线` : `本次发送 ${result.pushed} 条内容`);
      return resource.reload();
    }));
  const save = () => action.execute("save", () => {
    if (form.enabled && !robotValid) throw new Error("请选择已启用且配置完整的钉钉连接");
    return api(editing ? `/api/rss/subscriptions/${editing.id}` : "/api/rss/subscriptions", {
    method: editing ? "PATCH" : "POST", body: JSON.stringify(form),
  }).then(() => { setOpen(false); toast.success("订阅配置已保存"); return resource.reload(); });
  });

  return <>
    <ShellHeader title="RSS 订阅" meta="定时抓取订阅内容并发送钉钉通知">
      <Button onClick={() => { setEditing(null); setForm(emptyForm); setOpen(true); }}><PlusIcon />添加订阅</Button>
    </ShellHeader>
    <ScrollArea className="min-h-0 flex-1">
      <div className="p-4 sm:p-6">
        <ActionError error={action.error} />
        <ResourceState loading={false} error={robots.error} retry={robots.reload} />
        <ResourceState loading={resource.loading && !resource.data} error={resource.error}
          empty={resource.data?.subscriptions.length === 0} title="尚未添加订阅"
          description="添加 Feed 地址，并在连接器中配置钉钉机器人。" retry={resource.reload} />
        <div className="grid gap-5 xl:grid-cols-2">
        {resource.data?.subscriptions.map((item) => <Card key={item.id}>
          <CardHeader>
            <div className="flex items-center gap-3">
              <RssIcon className="size-4 text-primary" /><CardTitle className="min-w-0 flex-1 truncate">{item.name}</CardTitle>
              <Badge variant={item.enabled ? "outline" : "secondary"}>{item.enabled ? "已启用" : "已停用"}</Badge>
            </div>
            <CardDescription className="break-all">{item.url}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <dl className="grid grid-cols-2 gap-4 text-xs">
              <div><dt className="mb-1.5 text-muted-foreground">抓取间隔</dt><dd>{item.intervalMinutes} 分钟</dd></div>
              <div><dt className="mb-1.5 text-muted-foreground">已处理条目</dt><dd>{item.pushedCount} 条</dd></div>
              <div className="col-span-2"><dt className="mb-1.5 text-muted-foreground">钉钉机器人</dt><dd>{robotLabel(item.dingtalkRobotId)}</dd></div>
              <div className="col-span-2"><dt className="mb-1.5 text-muted-foreground">最近抓取</dt><dd>{item.lastFetchedAt ? formatDate(item.lastFetchedAt) : "尚未抓取"}</dd></div>
            </dl>
            {item.lastError && <p role="status" className="text-xs leading-6 text-destructive">{item.lastError}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" disabled={Boolean(action.pending)} onClick={() => fetchFeed(item)}>
                <RefreshCwIcon className={action.pending === item.id ? "animate-spin" : ""} />立即抓取
              </Button>
              <Button variant="outline" size="sm" onClick={() => {
                setEditing(item); setForm({ name: item.name, url: item.url, intervalMinutes: item.intervalMinutes, enabled: item.enabled, dingtalkRobotId: item.dingtalkRobotId }); setOpen(true);
              }}><PencilIcon />编辑</Button>
              <Button variant="ghost" size="sm" disabled={Boolean(action.pending) || (!item.enabled && !canEnable(item.dingtalkRobotId))} onClick={() => action.execute(item.id, () => api(`/api/rss/subscriptions/${item.id}`, {
                method: "PATCH", body: JSON.stringify({ enabled: !item.enabled }),
              }).then(resource.reload))}>{item.enabled ? "停用" : "启用"}</Button>
              <Button variant="ghost" size="icon-sm" className="ml-auto" disabled={Boolean(action.pending)} aria-label={`删除 ${item.name}`} onClick={() => remove(item)}><Trash2Icon /></Button>
            </div>
          </CardContent>
        </Card>)}
        </div>
      </div>
    </ScrollArea>
    <Modal open={open} title={editing ? "编辑订阅" : "添加订阅"} onClose={() => !action.pending && setOpen(false)} maxWidth="sm:max-w-lg">
      <form className="flex flex-col gap-6" onSubmit={(event) => { event.preventDefault(); save(); }}>
        <ActionError error={action.error} />
        <FieldGroup>
          <Field label="订阅名称"><Input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></Field>
          <Field label="Feed 地址"><Input type="url" required value={form.url} placeholder="https://example.com/feed.xml" onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))} /></Field>
          <Field label="抓取间隔（分钟）" hint="取值 5 至 1440 分钟。">
            <Input type="number" min={5} max={1440} required value={form.intervalMinutes} onChange={(event) => setForm((current) => ({ ...current, intervalMinutes: Number(event.target.value) }))} />
          </Field>
          <Checkbox label="启用订阅" checked={form.enabled} onChange={(enabled) => setForm((current) => ({ ...current, enabled }))} />
          <Field label="钉钉连接" error={robots.error} hint={robots.loading ? "正在加载连接…" : "启用订阅时必须选择已启用且配置完整的 Webhook 或 CLI 连接。"}>
            <Select required={form.enabled} disabled={robots.loading || Boolean(robots.error)} value={form.dingtalkRobotId ?? ""} onChange={(event) => setForm((current) => ({ ...current, dingtalkRobotId: event.target.value || null }))}>
              <option value="">请选择机器人</option>
              {form.dingtalkRobotId && robots.data && !selectedRobot && <option value={form.dingtalkRobotId} disabled>原关联机器人不可用</option>}
              {robots.data?.robots.map((robot) => <option key={robot.id} value={robot.id} disabled={!robot.enabled || !robot.isConfigured}>{robotLabel(robot.id)}</option>)}
            </Select>
          </Field>
        </FieldGroup>
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={Boolean(action.pending)} onClick={() => setOpen(false)}>取消</Button>
          <Button type="submit" disabled={Boolean(action.pending) || (form.enabled && !robotValid)}>{action.pending === "save" ? "正在保存…" : "保存配置"}</Button>
        </div>
      </form>
    </Modal>
    {confirmation.element}
  </>;
}
