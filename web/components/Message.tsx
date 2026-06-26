import { useState } from 'react';
import type { UIMessage } from 'ai';
import { ChevronRight, Wrench, User, Bot } from 'lucide-react';
import { cn } from '../lib/cn';

const TOOL_LABEL: Record<string, string> = {
  list_changed_files: '列出变更文件',
  fetch_diff: '获取 diff',
  read_file: '读取文件',
  post_review_comment: '发布审查评论',
  delegate_security: '委派安全审查',
  delegate_architecture: '委派架构审查',
  delegate_performance: '委派性能审查',
};

function ToolPart({ part }: { part: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const type = String(part.type ?? '');
  const name =
    type === 'dynamic-tool' ? String(part.toolName ?? '') : type.replace(/^tool-/, '');
  const state = String(part.state ?? '');
  const done = state === 'output-available';
  const errored = state === 'output-error';

  return (
    <div className="my-1.5 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/50 text-xs">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <Wrench size={13} className={cn(errored ? 'text-rose-400' : done ? 'text-emerald-400' : 'text-amber-400')} />
        <span className="font-medium text-neutral-300">{TOOL_LABEL[name] ?? name}</span>
        <span className="text-neutral-600">{errored ? '失败' : done ? '完成' : '执行中…'}</span>
        <ChevronRight size={13} className={cn('ml-auto text-neutral-600 transition', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-neutral-800 px-3 py-2">
          {part.input != null && (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-neutral-400">
              入参：{JSON.stringify(part.input, null, 2)}
            </pre>
          )}
          {part.output != null && (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] text-neutral-500">
              {typeof part.output === 'string' ? part.output : JSON.stringify(part.output, null, 2)}
            </pre>
          )}
          {errored && part.errorText != null && (
            <pre className="whitespace-pre-wrap text-[11px] text-rose-400">{String(part.errorText)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

export function Message({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex gap-3 px-4 py-3', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          isUser ? 'bg-neutral-700' : 'bg-emerald-900/60',
        )}
      >
        {isUser ? <User size={15} /> : <Bot size={15} />}
      </div>
      <div className={cn('min-w-0 max-w-[80%] space-y-1', isUser && 'items-end text-right')}>
        {message.parts.map((part, i) => {
          if (part.type === 'text') {
            return (
              <div
                key={i}
                className={cn(
                  'inline-block whitespace-pre-wrap break-words rounded-2xl px-4 py-2 text-sm leading-relaxed',
                  isUser ? 'bg-neutral-700 text-neutral-100' : 'bg-neutral-900 text-neutral-200',
                )}
              >
                {part.text}
              </div>
            );
          }
          if (part.type === 'reasoning') {
            return (
              <div key={i} className="rounded-lg bg-neutral-900/40 px-3 py-2 text-xs italic text-neutral-500">
                {part.text}
              </div>
            );
          }
          if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) {
            return <ToolPart key={i} part={part as unknown as Record<string, unknown>} />;
          }
          return null;
        })}
      </div>
    </div>
  );
}
