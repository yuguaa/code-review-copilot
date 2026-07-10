import BadgeCheck from 'lucide-react/dist/esm/icons/badge-check';
import Bot from 'lucide-react/dist/esm/icons/bot';
import Circle from 'lucide-react/dist/esm/icons/circle';
import CircleCheck from 'lucide-react/dist/esm/icons/circle-check';
import CircleX from 'lucide-react/dist/esm/icons/circle-x';
import Gauge from 'lucide-react/dist/esm/icons/gauge';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle';
import Network from 'lucide-react/dist/esm/icons/network';
import ScanSearch from 'lucide-react/dist/esm/icons/scan-search';
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check';
import { cn } from '../../lib/cn';
import type { ReviewActivityState, ReviewAgentActivity } from '@shared/review-activity';

const PHASE_LABEL: Record<ReviewActivityState['phase'], string> = {
  preparing: '准备审查',
  reviewing: '分析与取证',
  verifying: '复核结论',
  completed: '审查完成',
  failed: '审查中断',
};

function agentIcon(agent: ReviewAgentActivity) {
  if (agent.id === 'verifier') return BadgeCheck;
  if (agent.id === 'delegate-security') return ShieldCheck;
  if (agent.id === 'delegate-architecture') return ScanSearch;
  if (agent.id === 'delegate-performance') return Gauge;
  return Bot;
}

function statusIcon(status: ReviewAgentActivity['status']) {
  if (status === 'running') return Loader2;
  if (status === 'completed') return CircleCheck;
  if (status === 'failed') return CircleX;
  return Circle;
}

function orchestrationLabel(data: ReviewActivityState): string {
  const modelCount = new Set(data.agents.map((agent) => `${agent.provider}/${agent.modelId}`)).size;
  const agentCount = data.agents.length;
  if (agentCount <= 1) return '单 Agent 审查';
  return `多 Agent 编排 · ${agentCount} 个 Agent · ${modelCount === 1 ? '单模型复用' : `${modelCount} 个模型`}`;
}

function AgentRow({ agent }: { agent: ReviewAgentActivity }) {
  const AgentIcon = agentIcon(agent);
  const StatusIcon = statusIcon(agent.status);
  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-2.5 px-3 py-2.5">
      <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-[var(--r-sm)] border border-[var(--line-subtle)] bg-[var(--surface-card)] text-[var(--body-strong)]">
        <AgentIcon size={14} />
      </span>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xs font-semibold text-[var(--ink)]">{agent.label}</span>
          <span className="caption max-w-full truncate text-[var(--muted)]" title={`${agent.provider}/${agent.modelId}`}>
            {agent.provider}/{agent.modelId}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-[var(--body)]">{agent.task}</p>
      </div>
      <span
        className={cn(
          'caption mt-0.5 inline-flex items-center gap-1 whitespace-nowrap',
          agent.status === 'running' && 'text-[var(--warning)]',
          agent.status === 'completed' && 'text-[var(--success)]',
          agent.status === 'failed' && 'text-[var(--error)]',
          agent.status === 'pending' && 'text-[var(--muted-soft)]',
        )}
      >
        <StatusIcon size={12} className={agent.status === 'running' ? 'animate-spin' : undefined} />
        {agent.status === 'running' ? '进行中' : agent.status === 'completed' ? '完成' : agent.status === 'failed' ? '失败' : '等待'}
      </span>
    </div>
  );
}

export function ReviewAgentActivity({ data }: { data: ReviewActivityState }) {
  return (
    <section className="overflow-hidden rounded-[var(--r-md)] border border-[var(--line-default)] bg-[var(--surface-card)] shadow-[var(--shadow-sm)]">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--line-subtle)] bg-[var(--surface-soft)]/72 px-3 py-2.5">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--ink)]">
          <Network size={14} className="text-[var(--accent)]" />
          {orchestrationLabel(data)}
        </span>
        <span className="caption text-[var(--muted)]">当前阶段：{PHASE_LABEL[data.phase]}</span>
      </header>
      {data.agents.length > 0 ? (
        <div className="divide-y divide-[var(--line-subtle)]">
          {data.agents.map((agent) => <AgentRow key={agent.id} agent={agent} />)}
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-3 text-xs text-[var(--muted)]">
          <Loader2 size={13} className="animate-spin text-[var(--accent)]" />
          正在解析本次审查使用的模型与 Agent 编排
        </div>
      )}
    </section>
  );
}
