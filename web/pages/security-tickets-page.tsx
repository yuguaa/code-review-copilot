import { useEffect, useState } from 'react';
import { BugIcon, PlusIcon, ShieldAlertIcon, XCircleIcon } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { toast } from 'sonner';

import { ActionError, ResourceState } from '@web/components/common/resource-state';
import { ShellHeader } from '@web/components/layout/shell-header';
import {
  formatSecurityDate,
  isSecurityRunning,
  SecurityStatusBadge,
  securityRiskTone,
} from '@web/components/security/security-status';
import { Button } from '@web/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@web/components/ui/card';
import { Field, Select } from '@web/components/ui/forms';
import { Modal } from '@web/components/ui/modal';
import { ScrollArea } from '@web/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@web/components/ui/table';
import { useAction, useResource } from '@web/hooks/use-resource';
import { api } from '@web/lib/api';
import { cn } from '@web/lib/utils';

import type { SecurityTarget, SecurityTicketSummary } from '@web/lib/types';

export function SecurityTicketsPage() {
  const tickets = useResource<{ tickets: SecurityTicketSummary[]; total: number }>('/api/security/tickets');
  const targets = useResource<{ targets: SecurityTarget[] }>('/api/security/targets');
  const [createOpen, setCreateOpen] = useState(false);
  const [targetId, setTargetId] = useState('');
  const action = useAction();
  const availableTargets = (targets.data?.targets ?? []).filter((target) =>
    target.isActive && new Date(target.authorizedUntil).getTime() > Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      void tickets.reload();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [tickets.reload]);

  const createTicket = () => action.execute('create', () => {
    if (!targetId) throw new Error('请选择测试目标');
    return api<{ ticket: { id: string } }>('/api/security/tickets', {
      method: 'POST',
      body: JSON.stringify({ targetId }),
    }).then(() => {
      toast.success('安全测试工单已创建');
      setCreateOpen(false);
      setTargetId('');
      return tickets.reload();
    });
  });
  const cancelTicket = (ticket: SecurityTicketSummary) => action.execute(ticket.id, () =>
    api(`/api/security/tickets/${ticket.id}/cancel`, { method: 'POST' })
      .then(() => {
        toast.success('已提交取消请求');
        return tickets.reload();
      }));

  return <>
    <ShellHeader title="安全测试工单" meta="工单驱动 Agent Runtime，执行授权 Web/API 安全测试">
      <Button onClick={() => setCreateOpen(true)}><PlusIcon />新建工单</Button>
    </ShellHeader>
    <ScrollArea className="min-h-0 flex-1">
      <div className="p-4 sm:p-6">
        <ActionError error={action.error} />
        <ResourceState loading={tickets.loading && !tickets.data} error={tickets.error}
          empty={tickets.data?.tickets.length === 0} title="还没有安全测试工单"
          description="先配置测试目标，再发起手动工单或等待计划触发。" retry={tickets.reload} />
        {tickets.data && tickets.data.tickets.length > 0 && <ScrollArea orientation="horizontal" className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>目标</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>触发方式</TableHead>
              <TableHead>风险</TableHead>
              <TableHead>结果</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tickets.data.tickets.map((ticket) => <TableRow key={ticket.id}>
              <TableCell>
                <NavLink to={`/security/tickets/${ticket.id}`} className="font-medium hover:underline">{ticket.target.name}</NavLink>
                <p className="mt-1 max-w-56 truncate text-xs text-muted-foreground">{ticket.target.baseUrl}</p>
              </TableCell>
              <TableCell><SecurityStatusBadge status={ticket.status} /></TableCell>
              <TableCell className="text-xs text-muted-foreground">{ticket.triggerType === 'scheduled' ? '自动计划' : '手动触发'}</TableCell>
              <TableCell><span className={cn('font-mono text-sm font-semibold', securityRiskTone(ticket.riskScore))}>{ticket.riskScore ?? '—'}</span></TableCell>
              <TableCell className="max-w-72 text-xs">
                <p className={cn('line-clamp-2', ticket.error ? 'text-destructive' : 'text-muted-foreground')}>
                  {ticket.error || ticket.summary || '等待执行结果'}
                </p>
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatSecurityDate(ticket.createdAt)}</TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="sm" render={<NavLink to={`/security/tickets/${ticket.id}`} />}>详情</Button>
                  {isSecurityRunning(ticket.status) && <Button variant="ghost" size="sm" disabled={Boolean(action.pending)} onClick={() => cancelTicket(ticket)}><XCircleIcon />取消</Button>}
                </div>
              </TableCell>
            </TableRow>)}
          </TableBody>
        </Table>
        </ScrollArea>}
      {tickets.data?.tickets.length === 0 && targets.data && availableTargets.length === 0 && <Card className="mt-5 max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldAlertIcon className="size-4 text-primary" />
            {targets.data.targets.length === 0 ? '先配置测试目标' : '没有可用的测试目标'}
          </CardTitle>
          <CardDescription>
            {targets.data.targets.length === 0 ? '安全测试必须登记授权人和授权范围。' : '请启用目标并检查授权是否到期。'}
          </CardDescription>
        </CardHeader>
        <CardContent><Button render={<NavLink to="/security/targets" />}>前往测试目标</Button></CardContent>
      </Card>}
      {tickets.data?.tickets.length === 0 && availableTargets.length > 0 ? <div className="mt-5"><BugIcon className="size-4 text-primary" /><span className="ml-2 text-sm text-muted-foreground">目标已经准备完成，可以创建第一条工单。</span></div> : null}
      </div>
    </ScrollArea>
    <Modal open={createOpen} title="新建安全测试工单" onClose={() => !action.pending && setCreateOpen(false)} maxWidth="sm:max-w-lg">
      <form className="flex flex-col gap-6" onSubmit={(event) => { event.preventDefault(); createTicket(); }}>
        <ActionError error={action.error} />
        <Field label="测试目标" hint="工单创建后固定使用该目标的授权范围和模型配置。">
          <Select required value={targetId} onChange={(event) => setTargetId(event.target.value)}>
            <option value="">请选择测试目标</option>
            {availableTargets.map((target) => <option key={target.id} value={target.id}>{target.name} · {target.baseUrl}</option>)}
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={Boolean(action.pending)} onClick={() => setCreateOpen(false)}>取消</Button>
          <Button type="submit" disabled={!targetId || Boolean(action.pending)}>{action.pending === 'create' ? '正在创建…' : '创建并排队'}</Button>
        </div>
      </form>
    </Modal>
  </>;
}
