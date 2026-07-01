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
  Sparkles,
} from 'lucide-react';
import { api } from '../lib/api';
import type { SessionDetail } from '../lib/types';
import { Sidebar } from '../components/Sidebar';
import { Message } from '../components/Message';

export function Chat() {
  const { sessionId } = useParams();
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="flex h-full min-h-0 max-md:flex-col">
      <Sidebar refreshKey={refreshKey} />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--bg)]">
        {sessionId ? (
          <ChatView key={sessionId} sessionId={sessionId} onActivity={() => setRefreshKey((k) => k + 1)} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white text-indigo-600 shadow-[var(--shadow-md)] ring-1 ring-[var(--border)]">
              <MessageSquare size={24} />
            </div>
            <p className="text-sm font-semibold text-slate-800">选择左侧会话，或新建一个对话</p>
            <p className="max-w-sm text-xs leading-relaxed text-slate-500">
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

  if (error) return <div className="flex h-full items-center justify-center text-sm text-rose-400">{error}</div>;
  if (!detail) return <div className="flex h-full items-center justify-center text-sm text-slate-500">加载中…</div>;
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
  });
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const busy = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, status]);

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

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    void sendMessage({ text });
  };

  const s = detail.session;
  const shortHash = s.commitSha ? s.commitSha.slice(0, 8) : null;
  const branchText =
    s.sourceBranch && s.targetBranch ? `${s.sourceBranch} → ${s.targetBranch}` : s.sourceBranch ?? s.targetBranch ?? null;
  const statusView = {
    running: { label: '运行中', icon: CircleDashed, className: 'bg-amber-50 text-amber-700 ring-amber-200' },
    completed: { label: '已完成', icon: CheckCircle2, className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
    failed: { label: '失败', icon: AlertCircle, className: 'bg-rose-50 text-rose-700 ring-rose-200' },
  }[s.status] ?? { label: s.status, icon: CircleDashed, className: 'bg-slate-100 text-slate-600 ring-slate-200' };
  const StatusIcon = statusView.icon;

  return (
    <>
      <header className="border-b border-[var(--border)] bg-white/85 px-6 py-4 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl min-w-0 items-center justify-between gap-5">
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
                <Sparkles size={14} />
              </span>
              <h1 className="truncate text-base font-semibold text-slate-950">
              {s.kind === 'review' && s.mrIid ? `!${s.mrIid} ${s.mrTitle ?? ''}` : s.title ?? '新对话'}
              </h1>
            </div>
            {s.repository && (
              <p className="flex items-center gap-1.5 truncate pl-9 text-xs text-slate-500">
                <FolderGit2 size={12} className="shrink-0 text-slate-400" /> {s.repository.path}
              </p>
            )}
          </div>
          <div className="hidden shrink-0 items-center gap-2 text-[11px] text-slate-600 lg:flex">
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold ring-1 ${statusView.className}`}>
              <StatusIcon size={12} className={s.status === 'running' ? 'animate-spin' : undefined} /> {statusView.label}
            </span>
            {branchText && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 font-medium text-slate-700 ring-1 ring-slate-200">
                <GitBranch size={12} /> {branchText}
              </span>
            )}
            {shortHash && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 font-mono text-slate-700 ring-1 ring-slate-200">
                <Hash size={12} /> {shortHash}
              </span>
            )}
            {s.author && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-slate-700 ring-1 ring-slate-200">
                <UserRound size={12} /> {s.author}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <div ref={scrollRef} className="h-full min-w-0 overflow-y-auto">
          <div className="mx-auto max-w-6xl space-y-1 px-6 py-7">
            {messages.length === 0 && (
              <div className="mx-auto mt-10 max-w-md rounded-xl bg-white px-6 py-8 text-center shadow-[var(--shadow-sm)] ring-1 ring-[var(--border)]">
                <p className="text-sm font-semibold text-slate-800">开始对话吧</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">问一次审查结论、变更风险或某个文件的实现细节。</p>
              </div>
            )}
            {messages.map((m) => (
              <Message key={m.id} message={m} />
            ))}
            {busy && (
              <div className="mx-5 inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs text-slate-600 shadow-[var(--shadow-sm)] ring-1 ring-slate-200">
                <Loader2 size={13} className="animate-spin" /> Agent 思考中…
              </div>
            )}
            {!busy && s.status === 'running' && (
              <div className="mx-5 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-amber-200">
                <Loader2 size={13} className="animate-spin" /> 后台审查进行中，正在同步模型回复…
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--border)] bg-white/90 p-4 backdrop-blur-md">
        <div className="mx-auto max-w-4xl space-y-2">
          <div className="flex min-h-5 flex-wrap items-center justify-center gap-2 text-[11px] text-slate-600">
            {s.repository && (
              <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-indigo-50 px-2 py-1 font-medium text-indigo-700">
                <FolderGit2 size={12} /> {s.repository.path}
              </span>
            )}
            {branchText && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-slate-700">
                <GitBranch size={12} /> {branchText}
              </span>
            )}
            {(shortHash || s.author) && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-slate-700">
                {shortHash && <span className="font-mono">{shortHash}</span>}
                {shortHash && s.author ? <span className="text-slate-300">·</span> : null}
                {s.author}
              </span>
            )}
          </div>
          <div className="flex items-end gap-2 rounded-xl border border-[var(--border)] bg-white p-1.5 shadow-[var(--shadow-md)] transition-[border-color,box-shadow] focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              placeholder="继续追问，或要求重新审查…（Enter 发送，Shift+Enter 换行）"
              className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-500"
            />
            <button
              onClick={submit}
              disabled={busy || !input.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-white shadow-[var(--shadow-control)] transition-[background-color,transform] hover:bg-[var(--accent-strong)] active:scale-95 disabled:opacity-40"
            >
              <SendHorizontal size={16} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
