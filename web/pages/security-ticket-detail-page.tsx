import { useEffect } from 'react';
import { ArrowLeftIcon, DownloadIcon, ExternalLinkIcon, FileImageIcon, FileTextIcon, XCircleIcon } from 'lucide-react';
import { NavLink, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { ActionError, ResourceState } from '@web/components/common/resource-state';
import { ShellHeader } from '@web/components/layout/shell-header';
import { MarkdownBlock } from '@web/components/message/MarkdownBlock';
import {
  formatSecurityBytes,
  formatSecurityDate,
  isSecurityRunning,
  SecuritySeverityBadge,
  SecurityStatusBadge,
  securityRiskTone,
} from '@web/components/security/security-status';
import { Badge } from '@web/components/ui/badge';
import { Button } from '@web/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@web/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@web/components/ui/table';
import { useAction, useResource } from '@web/hooks/use-resource';
import { api } from '@web/lib/api';
import { cn } from '@web/lib/utils';

import type { SecurityArtifact, SecurityTicketDetail } from '@web/lib/types';

function artifactUrl(artifact: SecurityArtifact) {
  return `/api/security/artifacts/${artifact.id}/raw`;
}

function isImageArtifact(artifact: SecurityArtifact) {
  return artifact.type === 'screenshot' || artifact.mimeType.startsWith('image/');
}

export function SecurityTicketDetailPage() {
  const { ticketId = '' } = useParams();
  const resource = useResource<{ ticket: SecurityTicketDetail }>(ticketId ? `/api/security/tickets/${ticketId}` : null);
  const action = useAction();
  const ticket = resource.data?.ticket;
  const ticketStatus = ticket?.status;

  useEffect(() => {
    if (!ticketId) return;
    const events = new EventSource(`/api/security/tickets/${ticketId}/events`);
    const reload = () => { void resource.reload(); };
    const eventNames = [
      'ticket',
      'tool.start',
      'tool.end',
      'tool.error',
      'execution.started',
      'execution.completed',
      'execution.failed',
      'agent.message',
      'agent.protocol-warning',
      'notification.error',
      'changed',
    ];
    eventNames.forEach((name) => events.addEventListener(name, reload));
    events.addEventListener('open', reload);
    return () => events.close();
  }, [resource.reload, ticketId]);

  useEffect(() => {
    if (!ticketId || (ticketStatus && !isSecurityRunning(ticketStatus))) return;
    const timer = window.setInterval(() => {
      void resource.reload();
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [resource.reload, ticketId, ticketStatus]);

  const cancel = () => {
    if (!ticket) return;
    action.execute('cancel', () => api(`/api/security/tickets/${ticket.id}/cancel`, { method: 'POST' })
      .then(() => {
        toast.success('已提交取消请求');
        return resource.reload();
      }));
  };

  return <>
    <ShellHeader
      title={ticket?.target.name ?? '安全测试工单'}
      meta={ticket ? `${ticket.target.baseUrl} · ${ticket.triggerType === 'scheduled' ? '自动计划' : '手动触发'}` : '正在读取工单'}
    >
      <Button variant="outline" size="sm" render={<NavLink to="/security" />}><ArrowLeftIcon />返回工单</Button>
      {ticket && isSecurityRunning(ticket.status) && <Button variant="outline" size="sm" disabled={Boolean(action.pending)} onClick={cancel}><XCircleIcon />取消</Button>}
    </ShellHeader>
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <ActionError error={action.error} />
      <ResourceState loading={resource.loading && !ticket} error={resource.error} retry={resource.reload} />
      {ticket && <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-3">
              <SecurityStatusBadge status={ticket.status} />
              {ticket.riskScore != null && <Badge variant="outline" className={cn('font-mono', securityRiskTone(ticket.riskScore))}>风险 {ticket.riskScore}</Badge>}
              <span className="text-xs text-muted-foreground">{ticket.id}</span>
              <span className="flex-1" />
              {ticket.skillVersion && <Badge variant="secondary">{ticket.skillVersion}</Badge>}
            </div>
            <CardTitle className="mt-3">
              {ticket.summary || (isSecurityRunning(ticket.status) ? '安全测试正在执行' : '安全测试未生成摘要')}
            </CardTitle>
            {ticket.error && <CardDescription className="text-destructive">{ticket.error}</CardDescription>}
          </CardHeader>
          <CardContent className="grid gap-4 text-xs sm:grid-cols-2 xl:grid-cols-4">
            <div><p className="text-muted-foreground">授权人</p><p className="mt-1">{ticket.target.authorizationOwner}</p></div>
            <div><p className="text-muted-foreground">授权截止</p><p className="mt-1">{formatSecurityDate(ticket.target.authorizedUntil)}</p></div>
            <div><p className="text-muted-foreground">模型</p><p className="mt-1 break-all">{ticket.modelProvider && ticket.modelId ? `${ticket.modelProvider} / ${ticket.modelId}` : '尚未记录'}</p></div>
            <div><p className="text-muted-foreground">完成时间</p><p className="mt-1">{formatSecurityDate(ticket.finishedAt)}</p></div>
            <div className="sm:col-span-2 xl:col-span-4"><p className="text-muted-foreground">授权依据</p><p className="mt-1 break-words">{ticket.target.authorizationReference}</p></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>测试报告</CardTitle><CardDescription>Agent 生成的结论、影响与修复建议</CardDescription></CardHeader>
          <CardContent>
            {ticket.report
              ? <MarkdownBlock text={ticket.report} />
              : <p className="text-sm text-muted-foreground">
                {isSecurityRunning(ticket.status) ? '报告尚未生成。' : '本次工单没有生成执行报告。'}
              </p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>安全发现</CardTitle><CardDescription>共 {ticket.findings.length} 条结构化发现</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-4">
            {ticket.findings.length === 0 && <p className="text-sm text-muted-foreground">当前没有已记录的发现。</p>}
            {ticket.findings.map((finding) => <section key={finding.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <SecuritySeverityBadge severity={finding.severity} />
                <Badge variant="secondary">{finding.confidence}</Badge>
                {finding.category && <span className="text-xs text-muted-foreground">{finding.category}</span>}
                <span className="flex-1" />
                <code className="text-[10px] text-muted-foreground">{finding.fingerprint}</code>
              </div>
              <h3 className="mt-3 font-medium">{finding.title}</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-7">{finding.description}</p>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div><p className="mb-1 text-xs font-medium text-muted-foreground">证据</p><pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{finding.evidence}</pre></div>
                <div><p className="mb-1 text-xs font-medium text-muted-foreground">修复建议</p><p className="whitespace-pre-wrap text-sm leading-7">{finding.remediation}</p></div>
              </div>
            </section>)}
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>执行记录</CardTitle><CardDescription>每次运行独立保存，便于定位中断和重试</CardDescription></CardHeader>
            <CardContent className="flex flex-col gap-3">
              {ticket.executions.length === 0 && <p className="text-sm text-muted-foreground">没有执行记录。</p>}
              {ticket.executions.map((execution) => <div key={execution.id} className="rounded-lg border p-3 text-xs">
                <div className="flex items-center gap-2"><Badge variant="outline">{execution.status}</Badge><span className="text-muted-foreground">{formatSecurityDate(execution.startedAt)}</span></div>
                {execution.agentSessionId && <p className="mt-2 break-all text-muted-foreground">Session：{execution.agentSessionId}</p>}
                {execution.error && <p className="mt-2 text-destructive">{execution.error}</p>}
              </div>)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>执行事件</CardTitle><CardDescription>工具调用和状态变更留痕</CardDescription></CardHeader>
            <CardContent className="max-h-96 overflow-y-auto">
              {ticket.events.length === 0 && <p className="text-sm text-muted-foreground">没有事件记录。</p>}
              <ol className="flex flex-col gap-3">
                {ticket.events.map((event) => <li key={event.id} className="border-l-2 border-primary/30 pl-3 text-xs">
                  <p className="font-medium">{event.message}</p>
                  <p className="mt-1 text-muted-foreground">{event.type} · {formatSecurityDate(event.createdAt)}</p>
                </li>)}
              </ol>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>请求记录</CardTitle><CardDescription>共 {ticket.traffic.length} 条 HTTP 流量</CardDescription></CardHeader>
          <CardContent>
            {ticket.traffic.length === 0 ? <p className="text-sm text-muted-foreground">没有记录到 HTTP 请求。</p> : <div className="overflow-auto rounded-lg border">
              <Table><TableHeader><TableRow><TableHead>方法</TableHead><TableHead>地址</TableHead><TableHead>状态</TableHead><TableHead>耗时</TableHead></TableRow></TableHeader>
                <TableBody>{ticket.traffic.map((traffic) => <TableRow key={traffic.id}>
                  <TableCell className="font-mono text-xs">{traffic.method}</TableCell>
                  <TableCell className="max-w-xl break-all text-xs">{traffic.url}</TableCell>
                  <TableCell className="text-xs">{traffic.statusCode ?? '失败'}</TableCell>
                  <TableCell className="text-xs">{traffic.durationMs > 0 ? `${traffic.durationMs} ms` : '—'}</TableCell>
                </TableRow>)}</TableBody>
              </Table>
            </div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>证据文件</CardTitle><CardDescription>截图、结构化流量和最终报告</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-4">
            {ticket.artifacts.length === 0 && <p className="text-sm text-muted-foreground">没有保存证据文件。</p>}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {ticket.artifacts.map((artifact) => <div key={artifact.id} className="overflow-hidden rounded-lg border">
                {isImageArtifact(artifact) && <img src={artifactUrl(artifact)} alt={artifact.filename} className="aspect-video w-full bg-muted object-cover" />}
                <div className="flex flex-col gap-2 p-3">
                  <div className="flex items-center gap-2">
                    {isImageArtifact(artifact) ? <FileImageIcon className="size-4 text-primary" /> : <FileTextIcon className="size-4 text-primary" />}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{artifact.filename}</span>
                    <Badge variant="secondary">{artifact.type}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{artifact.mimeType} · {formatSecurityBytes(artifact.sizeBytes)}</p>
                  <Button variant="outline" size="sm" render={<a href={artifactUrl(artifact)} target="_blank" rel="noreferrer" />}><DownloadIcon />打开文件</Button>
                </div>
              </div>)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>报告文件</CardTitle><CardDescription>完整报告可作为 HTML 或 Markdown 归档</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {ticket.artifacts.filter((artifact) => artifact.type === 'report').map((artifact) => <Button key={artifact.id} variant="outline" render={<a href={artifactUrl(artifact)} target="_blank" rel="noreferrer" />}><ExternalLinkIcon />{artifact.filename}</Button>)}
            {!ticket.artifacts.some((artifact) => artifact.type === 'report') && <p className="text-sm text-muted-foreground">
              {isSecurityRunning(ticket.status) ? '报告文件正在生成。' : '本次工单没有生成报告文件。'}
            </p>}
          </CardContent>
        </Card>
      </div>}
    </div>
  </>;
}
