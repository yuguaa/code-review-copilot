import { useEffect, useRef, useState } from 'react';
import { ExternalLinkIcon, RefreshCwIcon, SquareIcon } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { ActionError, ResourceState } from '@web/components/common/resource-state';
import { RunStatusBadge } from '@web/components/common/run-status';
import { ShellHeader } from '@web/components/layout/shell-header';
import { MarkdownBlock } from '@web/components/message/MarkdownBlock';
import { ReviewChat } from '@web/components/review/review-chat';
import { RunDeliveries, RunMetadata } from '@web/components/review/run-panels';
import { Alert, AlertDescription, AlertTitle } from '@web/components/ui/alert';
import { Button } from '@web/components/ui/button';
import { Select } from '@web/components/ui/forms';
import { ScrollArea } from '@web/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@web/components/ui/tabs';
import { useAction, useResource } from '@web/hooks/use-resource';
import { api } from '@web/lib/api';
import { activeRunStatuses, formatDate, runStatusLabels } from '@web/lib/run-format';

import type { Dispatch, SetStateAction } from 'react';
import type { ReviewProgress, ReviewRun, SessionDetail } from '@web/lib/types';

type MessageTree = Pick<SessionDetail, 'messages' | 'messageTree' | 'activeLeafMessageId' | 'activePathIds'>;

function ReportPanel({ run, detail, update, onAsk }: {
  run: ReviewRun; detail: SessionDetail; update: Dispatch<SetStateAction<SessionDetail | null>>; onAsk: () => void;
}) {
  const reportId = run.reportMessageId;
  const message = detail.messages.find((item) => item.id === reportId);
  const text = message?.parts.filter((part) => part.type === 'text').map((part) => part.text).join('\n\n');
  const [content, setContent] = useState(text);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const loaded = useRef(false);

  useEffect(() => {
    if (text !== undefined) { loaded.current = true; setContent(text); return; }
    if (!reportId || loaded.current) return;
    const controller = new AbortController();
    setError(null);
    void api<MessageTree>(`/api/sessions/${detail.session.id}/active-message`, {
      method: 'POST', body: JSON.stringify({ messageId: reportId }), signal: controller.signal,
    }).then((tree) => update((current) => current ? { ...current, ...tree } : current)).catch((reason: unknown) => {
      if (reason instanceof Error && reason.name === 'AbortError') return;
      setError(reason instanceof Error ? reason.message : '报告读取失败');
    });
    return () => controller.abort();
  }, [detail.session.id, reportId, text, revision, update]);

  return <div className="mx-auto flex max-w-4xl flex-col gap-6 p-5 sm:p-8">
    {run.status === 'partial' && <Alert><AlertTitle>本次审查部分完成</AlertTitle><AlertDescription>请结合报告中的覆盖说明查看未完成范围。</AlertDescription></Alert>}
    {run.error && <Alert variant="destructive"><AlertTitle>运行信息</AlertTitle><AlertDescription>{run.error}</AlertDescription></Alert>}
    {!activeRunStatuses.has(run.status) && <Alert>
      <AlertTitle>分析本次运行</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>可以询问失败原因、审查结论、代码位置和后续处理方式。</span>
        <Button variant="outline" size="sm" onClick={onAsk}>询问助手</Button>
      </AlertDescription>
    </Alert>}
    <ResourceState error={error} retry={() => setRevision((current) => current + 1)} />
    {content ? <MarkdownBlock text={content} /> : !error && <ResourceState
      loading={Boolean(reportId && content === undefined)}
      empty={!reportId || content === ''}
      title={activeRunStatuses.has(run.status) ? '审查正在执行' : '本次运行没有报告正文'}
      description={activeRunStatuses.has(run.status) ? '执行状态会自动更新，报告保存后显示在这里。' : '请查看执行记录中的状态和错误信息。'}
    />}
  </div>;
}

export function ReviewDetail() {
  const { runId, sessionId } = useParams();
  const runResource = useResource<{ run: ReviewRun }>(runId ? `/api/runs/${runId}` : null);
  const selectedSession = sessionId ?? runResource.data?.run.sessionId;
  const session = useResource<SessionDetail>(selectedSession ? `/api/sessions/${selectedSession}` : null);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const action = useAction();
  const detail = session.data;
  const run = runId ? runResource.data?.run : detail?.runs[0];
  const [progress, setProgress] = useState<ReviewProgress[]>([]);
  const tab = params.get('tab') ?? (run ? 'report' : 'chat');

  useEffect(() => {
    if (!selectedSession) return;
    setProgress([]);
    const events = new EventSource(`/api/sessions/${selectedSession}/events`);
    const sync = () => { void session.reload(); if (runId) void runResource.reload(); };
    const onProgress = (event: Event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as ReviewProgress;
        if (payload.type !== 'review-progress' || !payload.runId || !payload.message) return;
        setProgress((current) => [...current.slice(-99), payload]);
      } catch {
        // Ignore malformed progress events; the session snapshot remains authoritative.
      }
    };
    events.addEventListener('open', sync);
    events.addEventListener('messages', sync);
    events.addEventListener('status', sync);
    events.addEventListener('review-error', sync);
    events.addEventListener('review-progress', onProgress);
    return () => events.close();
  }, [selectedSession, session.reload, runResource.reload, runId]);

  if (!detail || (runId && !run)) return <ResourceState loading={!session.error && !runResource.error} error={session.error ?? runResource.error} retry={() => { void session.reload(); void runResource.reload(); }} />;
  const active = detail.runs.some((item) => activeRunStatuses.has(item.status));
  const refresh = () => Promise.all([session.reload(), runId ? runResource.reload() : Promise.resolve()]).then(([next]) => next);
  const command = (path: 'stop-review' | 'review-command') => action.execute(path, () => api(`/api/sessions/${detail.session.id}/${path}`, { method: 'POST' }).then(() => {
    if (path === 'review-command') navigate(`/c/${detail.session.id}`);
    return refresh();
  }));

  return <>
    <ShellHeader title={detail.session.mrTitle || detail.session.title || '仓库对话'} meta={detail.session.repository?.path}>
      <Link to="/" className="mr-2 text-xs text-muted-foreground hover:text-foreground">返回审查历史</Link>
      {run && <RunStatusBadge status={run.status} />}
      {active ? <Button variant="outline" disabled={Boolean(action.pending) || detail.runs.some((item) => item.status === 'cancelling')} onClick={() => command('stop-review')}><SquareIcon />取消审查</Button> : detail.session.kind === 'review' && <Button variant="outline" disabled={Boolean(action.pending)} onClick={() => command('review-command')}><RefreshCwIcon />重新审查</Button>}
    </ShellHeader>
    <ActionError error={action.error || session.error || runResource.error} />
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3">
          <span className="text-xs text-muted-foreground">运行记录</span>
          <Select aria-label="选择历史运行" className="w-auto max-w-full" value={run?.id ?? ''} onChange={(event) => navigate(`/runs/${event.target.value}?tab=${tab}`)} disabled={!detail.runs.length}>
            {!detail.runs.length && <option value="">普通对话</option>}
            {detail.runs.map((item) => <option key={item.id} value={item.id}>{formatDate(item.startedAt ?? item.createdAt)} · {item.id.slice(0, 8)} · {runStatusLabels[item.status]}</option>)}
          </Select>
          {detail.session.webUrl && <Button variant="ghost" size="sm" className="ml-auto" render={<a href={detail.session.webUrl} target="_blank" rel="noreferrer" />}><ExternalLinkIcon />打开 GitLab</Button>}
        </div>
        <Tabs value={tab} onValueChange={(value) => setParams({ tab: String(value) }, { replace: true })} className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="border-b px-5"><TabsList variant="line" className="h-11"><TabsTrigger value="report" disabled={!run}>报告</TabsTrigger><TabsTrigger value="chat">继续对话</TabsTrigger><TabsTrigger value="execution" disabled={!run}>执行记录</TabsTrigger><TabsTrigger value="deliveries" disabled={!run}>发布结果</TabsTrigger></TabsList></div>
          <TabsContent value="report" className="min-h-0 overflow-hidden"><ScrollArea className="h-full">{run && <ReportPanel key={run.id} run={run} detail={detail} update={session.setData} onAsk={() => setParams({ tab: 'chat' }, { replace: true })} />}</ScrollArea></TabsContent>
          <TabsContent value="chat" className="flex min-h-0 flex-1 flex-col"><ReviewChat key={`${detail.session.id}:${run?.id ?? 'chat'}`} detail={detail} run={run} runId={run?.id} blocked={active} refresh={refresh} progress={progress} /></TabsContent>
          <TabsContent value="execution" className="min-h-0 overflow-hidden"><ScrollArea className="h-full"><div className="p-5 sm:p-8">{run && <RunMetadata run={run} />}</div></ScrollArea></TabsContent>
          <TabsContent value="deliveries" className="min-h-0 overflow-hidden"><ScrollArea className="h-full"><div className="p-5 sm:p-8">{run && <RunDeliveries run={run} reload={refresh} />}</div></ScrollArea></TabsContent>
        </Tabs>
      </div>
      {run && <aside className="hidden w-72 shrink-0 border-l xl:block" aria-label="运行摘要"><ScrollArea className="h-full"><div className="p-5"><RunMetadata run={run} /></div></ScrollArea></aside>}
    </div>
  </>;
}
