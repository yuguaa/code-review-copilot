import { useEffect, useId, useRef } from 'react';
import BadgeCheck from 'lucide-react/dist/esm/icons/badge-check';
import Bot from 'lucide-react/dist/esm/icons/bot';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import Gauge from 'lucide-react/dist/esm/icons/gauge';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle';
import Network from 'lucide-react/dist/esm/icons/network';
import ScanSearch from 'lucide-react/dist/esm/icons/scan-search';
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check';
import { cn } from '../../lib/cn';
import type { ReviewActivityState, ReviewAgentActivity } from '@shared/review-activity';
import {
  ReviewAgentDrawer,
  REVIEW_AGENT_INSPECTOR_PANEL_ID,
  reviewAgentStatusClass,
  reviewAgentStatusIcon,
  reviewAgentStatusLabel,
  useReviewAgentInspector,
} from './ReviewAgentDrawer';

const PHASE_LABEL: Record<ReviewActivityState['phase'], string> = {
  preparing: '准备审查',
  reviewing: '分析与取证',
  verifying: '复核结论',
  completed: '审查完成',
  failed: '审查中断',
};

function agentIcon(agent: ReviewAgentActivity) {
  if (agent.id === 'verifier' || agent.id.startsWith('verifier-')) return BadgeCheck;
  if (agent.id.startsWith('delegate-security')) return ShieldCheck;
  if (agent.id.startsWith('delegate-architecture')) return ScanSearch;
  if (agent.id.startsWith('delegate-performance')) return Gauge;
  return Bot;
}

function orchestrationLabel(data: ReviewActivityState): string {
  const modelCount = new Set(data.agents.map((agent) => `${agent.provider}/${agent.modelId}`)).size;
  const agentCount = data.agents.length;
  if (agentCount <= 1) return '单 Agent 审查';
  return `多 Agent 编排 · ${agentCount} 个 Agent · ${modelCount === 1 ? '单模型复用' : `${modelCount} 个模型`}`;
}

function AgentRow({
  agent,
  selected,
  onSelect,
}: {
  agent: ReviewAgentActivity;
  selected: boolean;
  onSelect: (agentId: string) => void;
}) {
  const AgentIcon = agentIcon(agent);
  const StatusIcon = reviewAgentStatusIcon(agent.status);
  const labelId = useId();
  const modelId = useId();
  const taskId = useId();
  const statusId = useId();
  const content = (
    <>
      <span
        className={cn(
          'review-agent-node mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-[var(--r-pill)] border border-[var(--line-default)] bg-[var(--surface-card)] text-[var(--body-strong)]',
          `is-${agent.status}`,
        )}
      >
        <AgentIcon size={15} />
      </span>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span id={labelId} className="text-sm font-semibold text-[var(--ink)]">{agent.label}</span>
          <span id={modelId} className="caption max-w-full truncate text-[var(--muted)]" title={`${agent.provider}/${agent.modelId}`}>
            {agent.provider}/{agent.modelId}
          </span>
        </div>
        <p id={taskId} className="mt-1 line-clamp-2 text-[13px] leading-5 text-[var(--body)]">{agent.task}</p>
      </div>
      <span className="mt-0.5 inline-flex items-center gap-2 whitespace-nowrap">
        <span id={statusId} className={cn('caption inline-flex items-center gap-1', reviewAgentStatusClass(agent.status))}>
          <StatusIcon size={12} className={agent.status === 'running' ? 'animate-spin' : undefined} />
          {reviewAgentStatusLabel(agent.status)}
        </span>
        {agent.trace && <ChevronRight size={14} className="text-[var(--muted-soft)]" />}
      </span>
    </>
  );

  const className = cn(
    'review-agent-row grid w-full grid-cols-[32px_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3.5 text-left',
    agent.trace && 'group/agent min-h-14 touch-manipulation cursor-pointer transition-[background-color,transform] [@media(hover:hover)]:hover:bg-[var(--surface-hover)] active:scale-[0.995]',
    selected && 'bg-[var(--surface-selected)] before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-[var(--accent)]',
  );

  if (!agent.trace) return <div className={className}>{content}</div>;
  return (
    <button
      type="button"
      className={className}
      onClick={() => onSelect(agent.id)}
      aria-expanded={selected}
      aria-controls={REVIEW_AGENT_INSPECTOR_PANEL_ID}
      aria-labelledby={`${labelId} ${statusId}`}
      aria-describedby={`${modelId} ${taskId}`}
    >
      {content}
    </button>
  );
}

export function ReviewAgentActivity({ data }: { data: ReviewActivityState }) {
  const { selection, selectAgent, closeInspector } = useReviewAgentInspector();
  const ownsSelection = selection?.runId === data.runId;
  const ownsSelectionRef = useRef(ownsSelection);
  ownsSelectionRef.current = ownsSelection;
  const selectedAgent = ownsSelection
    ? data.agents.find((agent) => agent.id === selection.agentId)
    : undefined;

  useEffect(() => () => {
    if (ownsSelectionRef.current) closeInspector();
  }, [closeInspector]);
  const agentStatusSummary = data.agents
    .map((agent) => `${agent.label}${reviewAgentStatusLabel(agent.status)}`)
    .join('；');

  return (
    <>
      {!selection && (
        <section
          aria-busy={data.phase !== 'completed' && data.phase !== 'failed'}
          className="review-agent-floating review-agent-pipeline overflow-hidden rounded-[var(--r-md)] border border-[var(--line-default)] bg-[var(--surface-card)] shadow-[var(--shadow-sm)]"
        >
          <span role="status" aria-live="polite" className="sr-only">
            当前阶段：{PHASE_LABEL[data.phase]}。{agentStatusSummary}
          </span>
          <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--line-default)] bg-[var(--surface-soft)] px-4 py-3">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--ink)]">
              <Network size={15} className="text-[var(--accent)]" />
              {orchestrationLabel(data)}
            </span>
            <span className="caption text-[var(--muted)]">当前阶段：{PHASE_LABEL[data.phase]}</span>
          </header>
          {data.agents.length > 0 ? (
            <div className="divide-y divide-[var(--line-subtle)]">
              {data.agents.map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  selected={false}
                  onSelect={(agentId) => selectAgent({ runId: data.runId, agentId })}
                />
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 px-4 py-4 text-sm text-[var(--muted)]">
              <Loader2 size={13} className="animate-spin text-[var(--accent)]" />
              正在解析本次审查使用的模型与 Agent 编排
            </div>
          )}
        </section>
      )}
      {selectedAgent && <ReviewAgentDrawer agent={selectedAgent} onClose={closeInspector} />}
    </>
  );
}
