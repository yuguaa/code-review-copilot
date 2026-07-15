import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import CircleCheck from 'lucide-react/dist/esm/icons/circle-check';
import CircleX from 'lucide-react/dist/esm/icons/circle-x';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle';
import { useId, useState } from 'react';
import { cn } from '../../lib/cn';

const TOOL_LABEL: Record<string, string> = {
  bash: '执行命令',
  read_file: '读取文件',
  git_diff: '查看变更 diff',
  read_memory: '读取项目记忆',
  write_memory: '更新项目记忆',
  record_evidence: '记录审查证据',
  record_verify_evidence: '记录复核证据',
  submit_verified_review: '提交复核结论',
  post_review_comment: '发布审查评论',
  post_inline_comment: '发布行级评论',
  send_dingtalk_notification: '发送钉钉通知',
  delegate_security: '委派安全审查',
  delegate_architecture: '委派架构审查',
  delegate_performance: '委派性能审查',
};

function toolName(part: Record<string, unknown>): string {
  const type = String(part.type ?? '');
  const raw = type === 'dynamic-tool' ? String(part.toolName ?? '') : type.replace(/^tool-/, '');
  return TOOL_LABEL[raw] ?? raw;
}

export function JsonPanel({ label, value, strong }: { label: string; value: unknown; strong?: boolean }) {
  const renderedValue = typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? String(value);
  return (
    <div className="space-y-1">
      <span className="caption text-[var(--muted-soft)]">{label}</span>
      <pre
        className={cn(
          'max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[var(--r-sm)] border border-[var(--line-subtle)] bg-[var(--surface-soft)] px-3 py-2.5 font-mono text-[11px] leading-relaxed',
          strong ? 'text-[var(--body-strong)]' : 'text-[var(--body)]',
        )}
      >
        {renderedValue}
      </pre>
    </div>
  );
}

export function ToolEvidenceBlock({ part }: { part: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const state = String(part.state ?? '');
  const done = state === 'output-available';
  const errored = state === 'output-error';
  const running = !done && !errored;
  const StatusIcon = errored ? CircleX : done ? CircleCheck : Loader2;

  return (
    <div className="tool-evidence-card overflow-hidden rounded-[var(--r-md)] border border-[var(--line-default)] bg-[var(--surface-card)] text-xs shadow-[var(--shadow-sm)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex min-h-10 w-full touch-manipulation items-center gap-2 px-3 py-2 text-left transition-[background-color,transform] [@media(hover:hover)]:hover:bg-[var(--surface-hover)] active:scale-[0.99]"
      >
        <StatusIcon
          size={13}
          className={cn('shrink-0', errored ? 'text-[var(--error)]' : done ? 'text-[var(--success)]' : 'animate-spin text-[var(--warning)]')}
        />
        <span className={cn('caption truncate', errored ? 'text-[var(--error)]' : 'text-[var(--body-strong)]')}>{toolName(part)}</span>
        {running && <span className="shrink-0 text-[var(--muted-soft)]">执行中</span>}
        <ChevronRight size={12} className={cn('ml-auto shrink-0 text-[var(--muted-soft)] transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div id={contentId} className="space-y-2 border-t border-[var(--line-subtle)] bg-[var(--surface-soft)]/78 px-3 py-2.5">
          {'input' in part && <JsonPanel label="输入" value={part.input} />}
          {'output' in part && <JsonPanel label="输出" value={part.output} strong />}
          {errored && part.errorText != null && <pre className="whitespace-pre-wrap break-words text-[11px] text-[var(--error)]">{String(part.errorText)}</pre>}
        </div>
      )}
    </div>
  );
}
