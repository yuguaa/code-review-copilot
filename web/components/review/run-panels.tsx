import { ExternalLinkIcon, SendIcon } from 'lucide-react';
import { toast } from 'sonner';

import { RunStatusBadge } from '@web/components/common/run-status';
import { ActionError } from '@web/components/common/resource-state';
import { Alert, AlertDescription, AlertTitle } from '@web/components/ui/alert';
import { Badge } from '@web/components/ui/badge';
import { Button } from '@web/components/ui/button';
import { useConfirm } from '@web/components/ui/confirm-dialog';
import { useAction } from '@web/hooks/use-resource';
import { api } from '@web/lib/api';
import { formatDate } from '@web/lib/run-format';

import type { ReviewRun } from '@web/lib/types';

export function RunMetadata({ run }: { run: ReviewRun }) {
  const values = [
    ['运行 ID', run.id], ['触发来源', run.triggerType], ['审查引擎', `${run.engineKey} ${run.engineVersion ?? ''}`],
    ['Provider', run.provider], ['模型', run.modelId], ['base SHA', run.baseSha], ['start SHA', run.startSha],
    ['head SHA', run.headSha], ['开始时间', formatDate(run.startedAt)], ['完成时间', formatDate(run.finishedAt)], ['Trace ID', run.traceId],
  ];
  const traceLink = `/observability/explore?${new URLSearchParams({ left: JSON.stringify({ datasource: 'tempo', queries: [{ refId: 'A', queryType: 'traceql', query: run.traceId }] }) })}`;
  return <div className="flex flex-col gap-6">
    <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">执行记录</h2><RunStatusBadge status={run.status} /></div>
    <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 gap-y-4 text-xs">{values.map(([label, value]) => <div key={label} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="break-all font-mono leading-5">{value || '尚未记录'}</dd></div>)}</dl>
    {run.error && <Alert variant="destructive"><AlertTitle>执行错误</AlertTitle><AlertDescription>{run.error}</AlertDescription></Alert>}
    {run.traceId && <Button variant="outline" render={<a href={traceLink} target="_blank" rel="noreferrer" />}><ExternalLinkIcon />查看关联 trace</Button>}
  </div>;
}

const deliveryLabels: Record<string, string> = {
  pending: '等待发送', sending: '正在发送', sent: '发送成功', failed: '发送失败', unknown: '结果未知', skipped: '已跳过',
};

export function RunDeliveries({ run, reload }: { run: ReviewRun; reload: () => Promise<unknown> }) {
  const action = useAction();
  const confirmation = useConfirm();
  const publish = (channel: 'gitlab' | 'dingtalk') => {
    void confirmation.confirm({
      title: `发布到 ${channel === 'gitlab' ? 'GitLab' : '钉钉'}`,
      description: `将运行 ${run.id.slice(0, 8)} 的报告发送到仓库配置的渠道。已有发布记录和提交版本由服务端核查。`, confirmLabel: '确认发布',
    }).then((approved) => {
      if (approved) action.execute(channel, () => api(`/api/runs/${run.id}/publish`, { method: 'POST', body: JSON.stringify({ channel }) }).then(() => {
        toast.success('发布请求已处理'); return reload();
      }));
    });
  };
  return <div className="flex flex-col gap-5">
    <ActionError error={action.error} />
    <div><h2 className="text-sm font-semibold">发布结果</h2><p className="mt-2 text-xs leading-6 text-muted-foreground">报告保存状态与渠道发送状态分别记录。</p></div>
    {(['gitlab', 'dingtalk'] as const).map((channel) => {
      const delivery = run.deliveries[channel];
      const disabled = Boolean(action.pending) || !run.reportMessageId || !['completed', 'partial', 'skipped'].includes(run.status) || delivery?.status === 'sending' || delivery?.status === 'sent';
      return <section key={channel} className="rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium">{channel === 'gitlab' ? 'GitLab 评论' : '钉钉机器人'}</h3><Button variant="outline" size="sm" disabled={disabled} onClick={() => publish(channel)}><SendIcon />{action.pending === channel ? '正在发布…' : '发布报告'}</Button></div>
        {!delivery ? <p className="mt-4 text-xs text-muted-foreground">尚未发布</p> : <div className="mt-4 flex flex-col gap-2 border-t pt-3">
          <div className="flex items-center justify-between"><Badge variant={delivery.status === 'failed' ? 'destructive' : 'secondary'}>{deliveryLabels[delivery.status] ?? delivery.status}</Badge><span className="text-[11px] text-muted-foreground">{formatDate(delivery.finishedAt ?? delivery.startedAt)}</span></div>
          {delivery.remoteIds?.map((id) => <p key={id} className="break-all font-mono text-xs">{id}</p>)}
          {delivery.error && <p className="text-xs leading-6 text-destructive">{delivery.error}</p>}
        </div>}
      </section>;
    })}
    {confirmation.element}
  </div>;
}
