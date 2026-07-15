import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import Circle from 'lucide-react/dist/esm/icons/circle';
import CircleCheck from 'lucide-react/dist/esm/icons/circle-check';
import CircleX from 'lucide-react/dist/esm/icons/circle-x';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle';
import X from 'lucide-react/dist/esm/icons/x';
import type {
  ReviewAgentActivity,
  ReviewAgentStatus,
  ReviewAgentToolTrace,
} from '@shared/review-activity';
import { cn } from '../../lib/cn';
import { ToolEvidenceBlock } from './ToolEvidenceBlock';

export function reviewAgentStatusLabel(status: ReviewAgentStatus): string {
  if (status === 'running') return '进行中';
  if (status === 'completed') return '完成';
  if (status === 'failed') return '失败';
  return '等待';
}

export function reviewAgentStatusClass(status: ReviewAgentStatus): string {
  if (status === 'running') return 'text-[var(--warning)]';
  if (status === 'completed') return 'text-[var(--success)]';
  if (status === 'failed') return 'text-[var(--error)]';
  return 'text-[var(--muted-soft)]';
}

export function reviewAgentStatusIcon(status: ReviewAgentStatus) {
  if (status === 'running') return Loader2;
  if (status === 'completed') return CircleCheck;
  if (status === 'failed') return CircleX;
  return Circle;
}

function toolPart(tool: ReviewAgentToolTrace): Record<string, unknown> {
  return {
    type: 'dynamic-tool',
    toolName: tool.toolName,
    state: tool.state,
    input: tool.input,
    ...(tool.errorText !== undefined ? { errorText: tool.errorText } : {}),
  };
}

export function ReviewAgentDrawer({ agent, onClose }: { agent: ReviewAgentActivity; onClose: () => void }) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const trace = agent.trace;
  const StatusIcon = reviewAgentStatusIcon(agent.status);
  const toolCount = trace?.steps.reduce((total, step) => total + step.tools.length, 0) ?? 0;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (!panelRef.current.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [onClose]);

  return createPortal(
    <div
      className="agent-drawer-backdrop fixed inset-0 z-[70] bg-[var(--surface-dark)]/28"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="agent-drawer-panel ml-auto flex h-full w-full max-w-[620px] flex-col overflow-hidden bg-[var(--surface-card)] shadow-[var(--shadow-popover)] sm:rounded-l-[var(--r-md)]"
      >
        <header className="shrink-0 border-b border-[var(--line-default)] bg-[var(--surface-card)] px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <p className="caption text-[var(--muted)]">子 Agent 审查过程</p>
              <h2 id={titleId} className="mt-1 truncate text-lg font-semibold text-[var(--ink)]" title={agent.label}>
                {agent.label}
              </h2>
              <p className="caption mt-1 truncate text-[var(--muted)]" title={`${agent.provider}/${agent.modelId}`}>
                {agent.provider}/{agent.modelId}
              </p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="关闭子 Agent 审查过程"
              className="flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-[var(--r-sm)] border border-transparent text-[var(--muted)] transition-[background-color,border-color,color,transform] [@media(hover:hover)]:hover:border-[var(--line-default)] [@media(hover:hover)]:hover:bg-[var(--surface-hover)] [@media(hover:hover)]:hover:text-[var(--ink)] active:scale-95"
            >
              <X size={17} />
            </button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--line-subtle)] pt-3">
            <span role="status" className={cn('caption inline-flex items-center gap-1.5', reviewAgentStatusClass(agent.status))}>
              <StatusIcon size={12} className={agent.status === 'running' ? 'animate-spin' : undefined} />
              {reviewAgentStatusLabel(agent.status)}
            </span>
            <span className="caption tabular-nums text-[var(--muted)]">{trace?.steps.length ?? 0} 个步骤</span>
            <span className="caption tabular-nums text-[var(--muted)]">{toolCount} 次工具调用</span>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:px-6">
          {trace ? (
            <div className="space-y-7">
              <section aria-labelledby={`${titleId}-input`}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 id={`${titleId}-input`} className="text-sm font-semibold text-[var(--ink)]">输入</h3>
                  <span className="caption text-[var(--muted-soft)]">委派任务</span>
                </div>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-[var(--r-md)] bg-[var(--surface-soft)] px-4 py-3 font-mono text-xs leading-6 text-[var(--body-strong)] shadow-[inset_0_0_0_1px_var(--line-subtle)]">
                  {trace.input}
                </pre>
              </section>

              <section aria-labelledby={`${titleId}-steps`}>
                <div className="mb-2 flex items-center justify-between gap-3 border-b border-[var(--line-default)] pb-2">
                  <h3 id={`${titleId}-steps`} className="text-sm font-semibold text-[var(--ink)]">执行轨迹</h3>
                  <span className="caption tabular-nums text-[var(--muted-soft)]">{trace.steps.length}</span>
                </div>
                {trace.steps.length > 0 ? (
                  <ol>
                    {trace.steps.map((step) => (
                      <li key={step.id} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 border-b border-[var(--line-subtle)] py-4 last:border-b-0">
                        <span className="caption flex h-7 w-7 items-center justify-center rounded-[var(--r-pill)] bg-[var(--state-info-bg)] tabular-nums text-[var(--primary)]">
                          {step.index}
                        </span>
                        <div className="min-w-0 space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium text-[var(--body-strong)]">步骤 {step.index}</span>
                            <span className="caption truncate text-[var(--muted-soft)]">{step.finishReason}</span>
                          </div>
                          {step.text.trim() ? (
                            <p className="whitespace-pre-wrap break-words text-sm leading-6 text-[var(--body)]">{step.text}</p>
                          ) : null}
                          {step.tools.length > 0 && (
                            <div className="space-y-2">
                              {step.tools.map((tool) => <ToolEvidenceBlock key={tool.toolCallId} part={toolPart(tool)} />)}
                            </div>
                          )}
                          {!step.text.trim() && step.tools.length === 0 && (
                            <p className="text-sm text-[var(--muted)]">本步骤未产生可展示内容。</p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-[var(--muted)]">
                    {agent.status === 'running' || agent.status === 'pending' ? (
                      <><Loader2 size={14} className="animate-spin text-[var(--warning)]" /> 等待首个执行步骤</>
                    ) : '没有记录到执行步骤'}
                  </div>
                )}
              </section>

              {trace.output !== undefined && (
                <section aria-labelledby={`${titleId}-output`}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 id={`${titleId}-output`} className="text-sm font-semibold text-[var(--ink)]">输出</h3>
                    <span className="caption text-[var(--muted-soft)]">最终结论</span>
                  </div>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-[var(--r-md)] bg-[var(--surface-soft)] px-4 py-3 font-mono text-xs leading-6 text-[var(--body-strong)] shadow-[inset_0_0_0_1px_var(--line-subtle)]">
                    {trace.output}
                  </pre>
                </section>
              )}

              {trace.errorText && (
                <section aria-labelledby={`${titleId}-error`} className="rounded-[var(--r-md)] bg-[var(--state-error-bg)] px-4 py-3 shadow-[inset_0_0_0_1px_rgba(217,45,32,0.16)]">
                  <h3 id={`${titleId}-error`} className="text-sm font-semibold text-[var(--error)]">执行失败</h3>
                  <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-[var(--error)]">{trace.errorText}</pre>
                </section>
              )}
              {trace.truncated && (
                <p className="rounded-[var(--r-md)] bg-[var(--state-warning-bg)] px-4 py-3 text-xs leading-5 text-[var(--warning)]">
                  审查轨迹已按安全与体积上限截断。
                </p>
              )}
            </div>
          ) : null}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
