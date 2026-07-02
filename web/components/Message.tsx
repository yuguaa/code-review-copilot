import { useState, type ReactNode } from 'react';
import type { UIMessage } from 'ai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronRight, Loader2, Webhook, Brain, CircleCheck, CircleX, CircleDashed } from 'lucide-react';
import { cn } from '../lib/cn';

const TOOL_LABEL: Record<string, string> = {
  bash: '执行命令',
  read_file: '读取文件',
  git_diff: '查看变更 diff',
  read_memory: '读取项目记忆',
  write_memory: '更新项目记忆',
  post_review_comment: '发布审查评论',
  post_inline_comment: '发布行级评论',
  delegate_security: '委派安全审查',
  delegate_architecture: '委派架构审查',
  delegate_performance: '委派性能审查',
};

type Part = UIMessage['parts'][number];

/** 消息 parts 分段：文本独立成段，工具调用 / 推理等过程性 parts 聚合成一个折叠组。 */
type Segment = { kind: 'text'; text: string } | { kind: 'process'; parts: Part[] };

function segmentParts(parts: Part[]): Segment[] {
  const segments: Segment[] = [];
  for (const part of parts) {
    if ((part.type as string) === 'step-start' || (part.type as string) === 'step-finish') continue;
    if (part.type === 'text') {
      if (part.text.trim()) segments.push({ kind: 'text', text: part.text });
      continue;
    }
    const last = segments[segments.length - 1];
    if (last?.kind === 'process') last.parts.push(part);
    else segments.push({ kind: 'process', parts: [part] });
  }
  return segments;
}

function toolName(part: Record<string, unknown>): string {
  const type = String(part.type ?? '');
  const raw = type === 'dynamic-tool' ? String(part.toolName ?? '') : type.replace(/^tool-/, '');
  return TOOL_LABEL[raw] ?? raw;
}

function isTool(part: Part): boolean {
  return part.type === 'dynamic-tool' || part.type.startsWith('tool-');
}

/** 单个过程步骤：一行状态 + 名称，点击展开入参出参。 */
function ProcessStep({ part }: { part: Part }) {
  const [open, setOpen] = useState(false);
  const record = part as unknown as Record<string, unknown>;

  if (part.type === 'reasoning') {
    const text = String(record.text ?? '');
    if (!text.trim()) return null;
    return (
      <div className="px-3 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 text-left text-[var(--muted)] transition-colors hover:text-[var(--body-strong)]"
        >
          <Brain size={13} className="shrink-0 text-[var(--brand-navy)]" />
          <span className="caption truncate">思考{open ? '' : `：${text.slice(0, 60)}`}</span>
          <ChevronRight size={12} className={cn('ml-auto shrink-0 text-[var(--muted-soft)] transition-transform', open && 'rotate-90')} />
        </button>
        {open && <p className="mt-1.5 whitespace-pre-wrap pl-[21px] leading-relaxed text-[var(--muted)]">{text}</p>}
      </div>
    );
  }

  if (!isTool(part)) {
    return (
      <div className="px-3 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 text-left text-[var(--muted)] transition-colors hover:text-[var(--body-strong)]"
        >
          <CircleDashed size={13} className="shrink-0 text-[var(--muted-soft)]" />
          <span className="truncate">{part.type}</span>
          <ChevronRight size={12} className={cn('ml-auto shrink-0 text-[var(--muted-soft)] transition-transform', open && 'rotate-90')} />
        </button>
        {open && (
            <pre className="caption mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words pl-[21px] text-[var(--muted)]">
            {JSON.stringify(part, null, 2)}
          </pre>
        )}
      </div>
    );
  }

  const state = String(record.state ?? '');
  const done = state === 'output-available';
  const errored = state === 'output-error';
  const running = !done && !errored;
  const StatusIcon = errored ? CircleX : done ? CircleCheck : Loader2;

  return (
    <div className="px-3 py-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left transition-colors hover:text-[var(--ink)]"
      >
        <StatusIcon
          size={13}
          className={cn(
            'shrink-0',
            errored ? 'text-[var(--error)]' : done ? 'text-[var(--success)]' : 'animate-spin text-[var(--warning)]',
          )}
        />
        <span className={cn('caption truncate', errored ? 'text-[var(--error)]' : 'text-[var(--body-strong)]')}>{toolName(record)}</span>
        {running && <span className="shrink-0 text-[var(--muted-soft)]">执行中</span>}
        <ChevronRight size={12} className={cn('ml-auto shrink-0 text-[var(--muted-soft)] transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5 pl-[21px]">
          {record.input != null && (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[var(--r-sm)] bg-[var(--surface-soft)] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[var(--body)] ring-1 ring-[var(--hairline)]">
              {JSON.stringify(record.input, null, 2)}
            </pre>
          )}
          {record.output != null && (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[var(--r-sm)] bg-[var(--surface-soft)] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[var(--body-strong)] ring-1 ring-[var(--hairline)]">
              {typeof record.output === 'string' ? record.output : JSON.stringify(record.output, null, 2)}
            </pre>
          )}
          {errored && record.errorText != null && (
            <pre className="whitespace-pre-wrap break-words text-[11px] text-[var(--error)]">{String(record.errorText)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

/** 过程折叠组：默认收起，仅显示进度摘要；执行中时在头部实时显示当前步骤。 */
function ProcessGroup({ parts }: { parts: Part[] }) {
  const [open, setOpen] = useState(false);
  const tools = parts.filter(isTool) as unknown as Record<string, unknown>[];
  const runningTool = tools.find((t) => {
    const state = String(t.state ?? '');
    return state !== 'output-available' && state !== 'output-error';
  });
  const erroredCount = tools.filter((t) => String(t.state ?? '') === 'output-error').length;

  return (
    <div className="my-3 overflow-hidden rounded-[var(--r-md)] border border-[var(--hairline)] bg-white text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--surface-soft)]"
      >
        <ChevronRight size={13} className={cn('shrink-0 text-[var(--muted-soft)] transition-transform', open && 'rotate-90')} />
        <span className="eyebrow text-[var(--body-strong)]">执行过程</span>
        <span className="caption text-[var(--muted)]">{parts.length} 步</span>
        {erroredCount > 0 && <span className="text-[var(--error)]">{erroredCount} 步失败</span>}
        {runningTool && (
          <span className="ml-auto inline-flex min-w-0 items-center gap-1.5 text-[var(--warning)]">
            <Loader2 size={12} className="shrink-0 animate-spin" />
            <span className="truncate">{toolName(runningTool)}</span>
          </span>
        )}
      </button>
      {open && (
        <div className="animate-fade-in divide-y divide-[var(--hairline)] border-t border-[var(--hairline)] bg-[var(--canvas)]">
          {parts.map((part, i) => (
            <ProcessStep key={i} part={part} />
          ))}
        </div>
      )}
    </div>
  );
}

function messageText(message: UIMessage): string {
  return message.parts
    .map((p) => (p.type === 'text' ? p.text : ''))
    .join('')
    .trim();
}

/** Webhook 触发的首条指令：折叠为一张紧凑的任务卡。 */
function TriggerCard({ message }: { message: UIMessage }) {
  const [open, setOpen] = useState(false);
  const text = messageText(message);
  return (
    <div className="my-3 overflow-hidden rounded-[var(--r-md)] border border-[var(--hairline)] bg-[var(--brand-lime)] text-xs text-[var(--ink)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-black/5"
      >
        <Webhook size={13} className="shrink-0 text-[var(--ink)]" />
        <span className="eyebrow text-[var(--ink)]">Webhook 触发审查</span>
        <span className="truncate text-[var(--body)]">{open ? '' : text.split('\n')[0]}</span>
        <ChevronRight size={13} className={cn('ml-auto shrink-0 text-[var(--muted-soft)] transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <pre className="animate-fade-in whitespace-pre-wrap break-words border-t border-black/15 bg-white/50 px-3 py-2.5 font-mono leading-relaxed text-[var(--body)]">
          {text}
        </pre>
      )}
    </div>
  );
}

function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

export function Message({ message, isTrigger }: { message: UIMessage; isTrigger?: boolean }) {
  if (isTrigger) return <TriggerCard message={message} />;

  if (message.role === 'user') {
    const text = messageText(message);
    return (
      <div className="flex justify-end py-3 pl-14">
        <div className="max-w-full whitespace-pre-wrap break-words rounded-[var(--r-md)] bg-[var(--ink)] px-4 py-2.5 text-sm leading-relaxed text-white">
          {text}
        </div>
      </div>
    );
  }

  // assistant：正文走文档流，过程性 parts 聚合折叠。
  const segments = segmentParts(message.parts);
  if (segments.length === 0) return null;
  return (
    <div className="py-4 pr-8 max-md:pr-0">
      {segments.map((seg, i): ReactNode => {
        if (seg.kind === 'text') return <Markdown key={i}>{seg.text}</Markdown>;
        return <ProcessGroup key={i} parts={seg.parts} />;
      })}
    </div>
  );
}
