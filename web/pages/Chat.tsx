import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import {
  SendHorizontal,
  Loader2,
  FolderGit2,
  GitBranch,
  Hash,
  UserRound,
  MessageSquare,
  CircleDashed,
  CheckCircle2,
  AlertCircle,
  Activity,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import type { SessionDetail } from '../lib/types';
import { Sidebar } from '../components/Sidebar';
import { Message } from '../components/Message';

export function Chat() {
  const { sessionId } = useParams();
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="flex h-full min-h-0 bg-[var(--canvas)] max-md:flex-col">
      <Sidebar refreshKey={refreshKey} />
      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {sessionId ? (
          <ChatView key={sessionId} sessionId={sessionId} onActivity={() => setRefreshKey((k) => k + 1)} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-[var(--r-lg)] bg-[var(--brand-peach)] text-[var(--ink)]">
              <MessageSquare size={26} />
            </div>
            <p className="font-display text-xl text-[var(--ink)]">选择左侧会话，或新建一个对话</p>
            <p className="max-w-sm text-sm leading-relaxed text-[var(--muted)]">
              每个 Webhook 触发的审查都会成为一个可追问的会话，按仓库归类在左侧。
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function ChatView({ sessionId, onActivity }: { sessionId: string; onActivity: () => void }) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(() => {
    return api<SessionDetail>(`/api/sessions/${sessionId}`)
      .then((next) => {
        setDetail(next);
        return next;
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : '加载失败');
        return null;
      });
  }, [sessionId]);

  useEffect(() => {
    setDetail(null);
    setError(null);
    void loadDetail();
  }, [loadDetail]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <AlertCircle size={22} className="text-[var(--brand-coral)]" />
        <p className="font-display text-lg text-[var(--ink)]">会话加载失败</p>
        <p className="text-sm text-[var(--muted)]">{error}</p>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-[var(--muted)]">
        <Loader2 size={15} className="animate-spin" /> 加载中…
      </div>
    );
  }
  return <ChatThread detail={detail} onActivity={onActivity} updateDetail={setDetail} />;
}

function ChatThread({
  detail,
  onActivity,
  updateDetail,
}: {
  detail: SessionDetail;
  onActivity: () => void;
  updateDetail: React.Dispatch<React.SetStateAction<SessionDetail | null>>;
}) {
  const sessionId = detail.session.id;
  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/chat', body: { sessionId } }),
    [sessionId],
  );
  const { messages, setMessages, sendMessage, status } = useChat({
    id: sessionId,
    messages: detail.messages,
    transport,
    onFinish: onActivity,
    onError: (e) => {
      let message = e.message || '回复失败，请稍后重试';
      try {
        message = (JSON.parse(message) as { error?: string }).error ?? message;
      } catch {
        // 非 JSON 响应体，原样展示
      }
      toast.error(message);
    },
  });
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nearBottomRef = useRef(true);
  const [scrollState, setScrollState] = useState({ top: true, bottom: true, scrollable: false });
  const busy = status === 'submitted' || status === 'streaming';

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const syncScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 3;
    nearBottomRef.current = bottom;
    setScrollState({
      top: el.scrollTop <= 2,
      bottom,
      scrollable: el.scrollHeight > el.clientHeight + 3,
    });
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (nearBottomRef.current) scrollToBottom('smooth');
      syncScrollState();
    });
    return () => cancelAnimationFrame(frame);
  }, [busy, messages, scrollToBottom, status, syncScrollState]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      scrollToBottom('auto');
      syncScrollState();
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollToBottom, sessionId, syncScrollState]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${Math.min(Math.max(el.scrollHeight, 40), 160)}px`;
    });
    return () => cancelAnimationFrame(frame);
  }, [input]);

  useEffect(() => {
    const events = new EventSource(`/api/sessions/${sessionId}/events`);

    events.addEventListener('messages', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as Pick<SessionDetail, 'messages'>;
      setMessages(payload.messages);
    });

    events.addEventListener('status', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as { status: string };
      updateDetail((current) =>
        current ? { ...current, session: { ...current.session, status: payload.status } } : current,
      );
      if (payload.status !== 'running') onActivity();
    });

    events.addEventListener('review-error', (event) => {
      if (!(event instanceof MessageEvent)) return;
      const payload = JSON.parse(event.data) as { error: string };
      updateDetail((current) =>
        current ? { ...current, session: { ...current.session, error: payload.error } } : current,
      );
    });

    return () => events.close();
  }, [onActivity, sessionId, setMessages, updateDetail]);

  const s = detail.session;
  // 审查进行中不允许追问：两条流程会并发整组覆盖落库导致消息丢失，服务端也会拒绝
  const reviewing = s.status === 'running';
  const composerDisabled = busy || reviewing;

  const submit = () => {
    const text = input.trim();
    if (!text || composerDisabled) return;
    nearBottomRef.current = true;
    setInput('');
    void sendMessage({ text });
  };

  const shortHash = s.commitSha ? s.commitSha.slice(0, 8) : null;
  const branchText =
    s.sourceBranch && s.targetBranch ? `${s.sourceBranch} → ${s.targetBranch}` : s.sourceBranch ?? s.targetBranch ?? null;
  const statusView = {
    running: { label: '审查中', icon: CircleDashed, className: 'bg-[var(--warning)]/15 text-[var(--warning)]' },
    completed: { label: '已完成', icon: CheckCircle2, className: 'bg-[var(--success)]/15 text-[var(--success)]' },
    failed: { label: '失败', icon: AlertCircle, className: 'bg-[var(--brand-coral)]/15 text-[var(--brand-coral)]' },
  }[s.status] ?? { label: s.status, icon: CircleDashed, className: 'bg-[var(--surface-strong)] text-[var(--muted)]' };
  const StatusIcon = statusView.icon;
  const isTriggerFirst = s.kind === 'review' && messages[0]?.role === 'user';

  const pill = 'inline-flex max-w-56 items-center gap-1 rounded-full bg-[var(--surface-card)] px-2.5 py-1 text-[var(--body-strong)]';

  return (
    <>
      <header className="z-10 border-b border-[var(--hairline)] bg-[var(--canvas)] px-6 py-4 max-md:px-4">
        <div className="mx-auto flex max-w-4xl min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-64">
            <h1 className="font-display truncate text-lg text-[var(--ink)]">
              {s.kind === 'review' && s.mrIid ? `!${s.mrIid} ${s.mrTitle ?? ''}` : s.title ?? '新对话'}
            </h1>
            {s.repository && (
              <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-[var(--muted)]">
                <FolderGit2 size={12} className="shrink-0 text-[var(--muted-soft)]" /> {s.repository.path}
              </p>
            )}
          </div>
          <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-1.5 text-[11px] font-medium">
            <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold', statusView.className)}>
              <StatusIcon size={12} className={s.status === 'running' ? 'animate-spin' : undefined} /> {statusView.label}
            </span>
            {branchText && (
              <span className={pill}>
                <GitBranch size={12} className="shrink-0 text-[var(--muted-soft)]" /> <span className="truncate">{branchText}</span>
              </span>
            )}
            {shortHash && (
              <span className={cn(pill, 'font-mono')}>
                <Hash size={12} className="shrink-0 text-[var(--muted-soft)]" /> {shortHash}
              </span>
            )}
            {s.author && (
              <span className={pill}>
                <UserRound size={12} className="shrink-0 text-[var(--muted-soft)]" /> <span className="truncate">{s.author}</span>
              </span>
            )}
          </div>
        </div>
      </header>

      <div
        className={[
          'conversation-frame min-h-0 flex-1',
          scrollState.scrollable && !scrollState.top ? 'is-scrolled' : '',
          scrollState.scrollable && !scrollState.bottom ? 'can-scroll-more' : '',
        ].join(' ')}
      >
        <div ref={scrollRef} onScroll={syncScrollState} className="conversation-scroll h-full min-w-0 overflow-y-auto">
          <div className="mx-auto max-w-4xl px-6 py-5 max-md:px-4">
            {/* 审查失败原因必须直接可见，让用户能自助修复配置 */}
            {s.status === 'failed' && s.error && (
              <div className="mb-3 flex items-start gap-2.5 rounded-[var(--r-md)] border border-[var(--brand-coral)]/30 bg-[var(--brand-coral)]/8 px-4 py-3 text-sm text-[var(--body-strong)]">
                <AlertCircle size={16} className="mt-0.5 shrink-0 text-[var(--brand-coral)]" />
                <div className="min-w-0 space-y-0.5">
                  <p className="font-semibold text-[var(--ink)]">本次审查失败</p>
                  <p className="break-words text-xs leading-relaxed">{s.error}</p>
                  {/模型|apiKey|api key/i.test(s.error) && (
                    <p className="text-xs text-[var(--brand-coral)]">请到「设置 → 全局模型配置」或仓库的模型配置中补全后重试。</p>
                  )}
                </div>
              </div>
            )}
            {messages.length === 0 && (
              <div className="mx-auto mt-16 max-w-md rounded-[var(--r-xl)] bg-[var(--brand-peach)] px-7 py-9 text-center text-[var(--ink)]">
                <p className="font-display text-xl">开始对话吧</p>
                <p className="mt-2 text-sm leading-relaxed opacity-80">问一次审查结论、变更风险或某个文件的实现细节。</p>
              </div>
            )}
            {messages.map((m, i) => (
              <Message key={m.id} message={m} isTrigger={isTriggerFirst && i === 0} />
            ))}
            {busy && (
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--hairline)] bg-white px-3 py-1.5 text-xs text-[var(--muted)]">
                <Loader2 size={13} className="animate-spin text-[var(--brand-pink)]" /> Agent 思考中…
              </div>
            )}
            {!busy && reviewing && (
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--warning)]/30 bg-[var(--warning)]/12 px-3 py-1.5 text-xs text-[var(--warning)]">
                <Activity size={13} /> 后台审查进行中，回复会实时同步到这里
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="z-10 border-t border-[var(--hairline)] bg-[var(--canvas)] p-4 max-md:p-3">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-end gap-2 rounded-[var(--r-lg)] border border-[var(--hairline)] bg-white p-1.5 transition-[border-color,box-shadow] focus-within:border-[var(--ink)] focus-within:ring-4 focus-within:ring-[var(--ring)]">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              disabled={reviewing}
              placeholder={
                reviewing ? '审查进行中，完成后即可追问…' : '继续追问，或要求重新审查…（Enter 发送，Shift+Enter 换行）'
              }
              className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--muted-soft)] disabled:cursor-not-allowed"
            />
            <button
              onClick={submit}
              disabled={composerDisabled || !input.trim()}
              aria-label="发送"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-md)] bg-[var(--primary)] text-white transition-opacity hover:opacity-90 active:scale-95 disabled:opacity-40"
            >
              <SendHorizontal size={16} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
