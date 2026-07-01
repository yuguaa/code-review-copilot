import { useState } from 'react';
import type { UIMessage } from 'ai';
import { ChevronRight, Wrench, User, Bot, Sparkles } from 'lucide-react';
import { cn } from '../lib/cn';

const TOOL_LABEL: Record<string, string> = {
  list_changed_files: '列出变更文件',
  fetch_diff: '获取 diff',
  read_file: '读取文件',
  post_review_comment: '发布审查评论',
  post_inline_comment: '发布行级评论',
  notify_dingtalk: '推送钉钉通知',
  read_memory: '读取项目记忆',
  write_memory: '更新项目记忆',
  delegate_security: '委派安全审查',
  delegate_architecture: '委派架构审查',
  delegate_performance: '委派性能审查',
};

const EVENT_LABEL: Record<string, string> = {
  'step-start': '模型开始生成',
  'step-finish': '模型完成一步',
  'source-url': '引用链接',
  'source-document': '引用文档',
  file: '生成文件',
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
    <div className="my-2 overflow-hidden rounded-xl bg-white text-xs shadow-[var(--shadow-sm)] ring-1 ring-[var(--border)]">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
            errored ? 'bg-rose-50 text-rose-600' : done ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600',
          )}
        >
          <Wrench size={13} />
        </span>
        <span className="font-semibold text-slate-800">{TOOL_LABEL[name] ?? name}</span>
        <span className="text-slate-500">{errored ? '失败' : done ? '完成' : '执行中'}</span>
        <ChevronRight size={13} className={cn('ml-auto text-slate-400 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-slate-100 bg-slate-50/80 px-3 py-2">
          {part.input != null && (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-600">
              入参：{JSON.stringify(part.input, null, 2)}
            </pre>
          )}
          {part.output != null && (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-700">
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

function EventPart({ part }: { part: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const type = String(part.type ?? 'unknown');
  const label = EVENT_LABEL[type] ?? `模型事件：${type}`;
  return (
    <div className="my-2 overflow-hidden rounded-xl bg-white text-xs shadow-[var(--shadow-sm)] ring-1 ring-[var(--border)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 transition-[background-color] hover:bg-indigo-50/60"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-indigo-600">
          <Sparkles size={13} />
        </span>
        <span className="font-semibold">{label}</span>
        <ChevronRight size={13} className={cn('ml-auto text-slate-400 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <pre className="max-h-64 overflow-auto border-t border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          {JSON.stringify(part, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function Message({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex gap-3 py-3.5', isUser ? 'justify-end pl-16' : 'justify-start pr-16')}>
      <div
        className={cn(
          'mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow-[var(--shadow-control)]',
          isUser
            ? 'order-2 bg-[var(--accent)] text-white'
            : 'bg-white text-indigo-600 ring-1 ring-[var(--border)]',
        )}
      >
        {isUser ? <User size={15} /> : <Bot size={15} />}
      </div>
      <div className={cn('flex min-w-0 max-w-[76%] flex-col space-y-1', isUser ? 'items-end text-right' : 'items-start')}>
        {message.parts.map((part, i) => {
          if (part.type === 'text') {
            return (
              <div
                key={i}
                className={cn(
                  'inline-block whitespace-pre-wrap break-words px-4 py-3 text-sm leading-relaxed',
                  isUser
                    ? 'rounded-xl rounded-tr-md bg-[var(--accent)] text-white shadow-[var(--shadow-sm)]'
                    : 'rounded-xl rounded-tl-md bg-white text-slate-800 shadow-[var(--shadow-sm)] ring-1 ring-[var(--border)]',
                )}
              >
                {part.text}
              </div>
            );
          }
          if (part.type === 'reasoning') {
            return (
              <div key={i} className="rounded-lg bg-indigo-50 px-3 py-2 text-xs leading-relaxed text-indigo-800 ring-1 ring-indigo-100">
                {part.text}
              </div>
            );
          }
          if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) {
            return <ToolPart key={i} part={part as unknown as Record<string, unknown>} />;
          }
          return <EventPart key={i} part={part as unknown as Record<string, unknown>} />;
        })}
      </div>
    </div>
  );
}
