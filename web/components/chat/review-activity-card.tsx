import { useEffect, useRef, useState } from 'react';
import {
  BadgeCheckIcon,
  BotIcon,
  ChevronDownIcon,
  GaugeIcon,
  LoaderCircleIcon,
  NetworkIcon,
  ScanSearchIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import type { ReviewActivityState, ReviewAgentActivity } from '@shared/review-activity';
import { cn } from '@web/lib/utils';
import { Badge } from '@web/components/ui/badge';
import { Button } from '@web/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@web/components/ui/collapsible';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@web/components/ui/sheet';
import { Tool, ToolContent, ToolHeader, ToolInput } from '@web/components/ai-elements/tool';

const PHASE_LABEL: Record<ReviewActivityState['phase'], string> = {
  preparing: '准备审查',
  reviewing: '分析与取证',
  verifying: '复核结论',
  completed: '审查完成',
  failed: '审查中断',
};

const STATUS_LABEL = {
  pending: '等待',
  running: '进行中',
  completed: '完成',
  failed: '失败',
} as const;

function agentIcon(agent: ReviewAgentActivity) {
  if (agent.id === 'verifier' || agent.id.startsWith('verifier-')) return BadgeCheckIcon;
  if (agent.id.startsWith('delegate-security')) return ShieldCheckIcon;
  if (agent.id.startsWith('delegate-architecture')) return ScanSearchIcon;
  if (agent.id.startsWith('delegate-performance')) return GaugeIcon;
  return BotIcon;
}

function statusTone(status: ReviewAgentActivity['status']) {
  if (status === 'running') return 'text-warning';
  if (status === 'completed') return 'text-success';
  if (status === 'failed') return 'text-destructive';
  return 'text-muted-foreground';
}

/** 审查编排卡片：审查进行中默认展开，结束后自动收起；列表限高避免护占消息区。 */
export function ReviewActivityCard({ data }: { data: ReviewActivityState }) {
  const isRunning = data.phase !== 'completed' && data.phase !== 'failed';
  const [open, setOpen] = useState(isRunning);
  const userToggled = useRef(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const selectedAgent = data.agents.find((agent) => agent.id === selectedAgentId);

  useEffect(() => {
    if (userToggled.current) return;
    setOpen(data.phase !== 'completed' && data.phase !== 'failed');
  }, [data.phase]);

  const modelCount = new Set(data.agents.map((agent) => `${agent.provider}/${agent.modelId}`)).size;
  const orchestration =
    data.agents.length <= 1
      ? '单 Agent 审查'
      : `多 Agent 编排 · ${data.agents.length} 个 Agent · ${modelCount === 1 ? '单模型复用' : `${modelCount} 个模型`}`;

  return (
    <>
      <Collapsible
        open={open}
        onOpenChange={(next) => {
          userToggled.current = true;
          setOpen(next);
        }}
      >
        <div className="overflow-hidden rounded-lg border bg-card">
          <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50">
            <NetworkIcon className="size-4 shrink-0" />
            <span className="text-sm font-medium">{orchestration}</span>
            <Badge variant="secondary" className="ml-auto shrink-0">
              {PHASE_LABEL[data.phase]}
            </Badge>
            <ChevronDownIcon
              className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            {data.agents.length === 0 ? (
              <p className="flex items-center gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
                <LoaderCircleIcon className="size-4 animate-spin" />
                正在解析本次审查使用的模型与 Agent 编排
              </p>
            ) : (
              <ul className="max-h-48 divide-y overflow-y-auto border-t">
                {data.agents.map((agent) => {
                  const AgentIcon = agentIcon(agent);
                  return (
                    <li key={agent.id}>
                      <button
                        type="button"
                        disabled={!agent.trace}
                        onClick={() => setSelectedAgentId(agent.id)}
                        className={cn(
                          'grid w-full grid-cols-[32px_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 text-left',
                          agent.trace && 'transition-colors hover:bg-muted/50',
                        )}
                      >
                        <span className="flex size-8 items-center justify-center rounded-full border bg-background">
                          <AgentIcon className="size-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-sm font-medium">{agent.label}</span>
                            <span className="truncate font-mono text-xs text-muted-foreground">
                              {agent.provider}/{agent.modelId}
                            </span>
                          </span>
                          <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                            {agent.task}
                          </span>
                        </span>
                        <span className={cn('mt-1 shrink-0 text-xs font-medium', statusTone(agent.status))}>
                          {STATUS_LABEL[agent.status]}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CollapsibleContent>
        </div>
      </Collapsible>

      <Sheet
        open={Boolean(selectedAgent)}
        onOpenChange={(next) => {
          if (!next) setSelectedAgentId(null);
        }}
      >
        <SheetContent className="flex w-full flex-col gap-0 overflow-hidden sm:max-w-xl">
          {selectedAgent ? <AgentTracePanel agent={selectedAgent} /> : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function AgentTracePanel({ agent }: { agent: ReviewAgentActivity }) {
  const trace = agent.trace;
  const toolCount = trace?.steps.reduce((total, step) => total + step.tools.length, 0) ?? 0;

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle className="truncate">{agent.label}</SheetTitle>
        <SheetDescription className="truncate font-mono text-xs">
          {agent.provider}/{agent.modelId}
        </SheetDescription>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{STATUS_LABEL[agent.status]}</Badge>
          <span className="text-xs text-muted-foreground tabular-nums">{trace?.steps.length ?? 0} 个步骤</span>
          <span className="text-xs text-muted-foreground tabular-nums">{toolCount} 次工具调用</span>
        </div>

        {trace ? (
          <>
            <section className="space-y-2">
              <h3 className="text-sm font-medium">委派任务</h3>
              <pre className="max-h-48 overflow-auto rounded-lg bg-muted/50 px-3 py-2 font-mono text-xs leading-6 whitespace-pre-wrap">
                {trace.input}
              </pre>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-medium">执行轨迹</h3>
              {trace.steps.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  {agent.status === 'running' || agent.status === 'pending' ? (
                    <>
                      <LoaderCircleIcon className="size-4 animate-spin" />
                      等待首个执行步骤
                    </>
                  ) : (
                    '没有记录到执行步骤'
                  )}
                </p>
              ) : (
                <ol className="space-y-4">
                  {trace.steps.map((step) => (
                    <li key={step.id} className="space-y-2 border-l pl-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium">步骤 {step.index}</span>
                        <span className="truncate text-xs text-muted-foreground">{step.finishReason}</span>
                      </div>
                      {step.text.trim() ? (
                        <p className="text-sm leading-6 whitespace-pre-wrap">{step.text}</p>
                      ) : null}
                      {step.tools.map((tool) => (
                        <Tool key={tool.toolCallId} defaultOpen={false}>
                          <ToolHeader
                            title={tool.toolName}
                            type={`tool-${tool.toolName}` as never}
                            state={tool.state as never}
                          />
                          <ToolContent>
                            <ToolInput input={tool.input} />
                          </ToolContent>
                        </Tool>
                      ))}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {trace.output !== undefined ? (
              <section className="space-y-2">
                <h3 className="text-sm font-medium">最终结论</h3>
                <pre className="max-h-72 overflow-auto rounded-lg bg-muted/50 px-3 py-2 font-mono text-xs leading-6 whitespace-pre-wrap">
                  {trace.output}
                </pre>
              </section>
            ) : null}

            {trace.errorText ? (
              <section className="space-y-2 rounded-lg bg-destructive/10 px-3 py-2">
                <h3 className="text-sm font-medium text-destructive">执行失败</h3>
                <pre className="font-mono text-xs leading-5 whitespace-pre-wrap text-destructive">{trace.errorText}</pre>
              </section>
            ) : null}

            {trace.truncated ? (
              <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                审查轨迹已按安全与体积上限截断。
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}

/** 后台审查进行中、还没有编排数据时的轻量提示。 */
export function ReviewPendingNotice({ onStop, stopping }: { onStop: () => void; stopping: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
      <LoaderCircleIcon className="size-4 shrink-0 animate-spin" />
      <span className="text-sm">后台审查进行中，回复会实时同步到这里</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="ml-auto"
        disabled={stopping}
        onClick={onStop}
      >
        {stopping ? '停止中…' : '停止审查'}
      </Button>
    </div>
  );
}
