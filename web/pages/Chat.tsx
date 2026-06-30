import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { SendHorizontal, Loader2, FolderGit2, GitBranch, Hash, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import type { SessionDetail } from '../lib/types';
import { Sidebar } from '../components/Sidebar';
import { Message } from '../components/Message';

export function Chat() {
  const { sessionId } = useParams();
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="flex h-full">
      <Sidebar refreshKey={refreshKey} />
      <main className="flex min-w-0 flex-1 flex-col bg-sky-50/40">
        {sessionId ? (
          <ChatView key={sessionId} sessionId={sessionId} onActivity={() => setRefreshKey((k) => k + 1)} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500">
            <p className="text-sm">选择左侧会话，或点击 + 新建对话</p>
            <p className="text-xs text-slate-400">每个 webhook 触发的审查都会成为一个可追问的会话</p>
          </div>
        )}
      </main>
    </div>
  );
}

function ChatView({ sessionId, onActivity }: { sessionId: string; onActivity: () => void }) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null);
    setError(null);
    api<SessionDetail>(`/api/sessions/${sessionId}`)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'));
  }, [sessionId]);

  if (error) return <div className="flex h-full items-center justify-center text-sm text-rose-400">{error}</div>;
  if (!detail) return <div className="flex h-full items-center justify-center text-sm text-slate-500">加载中…</div>;
  return <ChatThread detail={detail} onActivity={onActivity} />;
}

function ChatThread({ detail, onActivity }: { detail: SessionDetail; onActivity: () => void }) {
  const sessionId = detail.session.id;
  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/chat', body: { sessionId } }),
    [sessionId],
  );
  const { messages, sendMessage, status } = useChat({
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

  return (
    <>
      <header className="border-b border-sky-100 bg-white/90 px-6 py-3 shadow-sm backdrop-blur">
        <div className="flex min-w-0 items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-slate-950">
            {s.kind === 'review' && s.mrIid ? `!${s.mrIid} ${s.mrTitle ?? ''}` : s.title ?? '对话'}
            </h1>
            {s.repository && <p className="truncate text-xs text-slate-500">{s.repository.path}</p>}
          </div>
          <div className="hidden shrink-0 items-center gap-2 text-[11px] text-slate-500 lg:flex">
            {branchText && (
              <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-teal-700">
                <GitBranch size={12} /> {branchText}
              </span>
            )}
            {shortHash && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 font-mono text-slate-700">
                <Hash size={12} /> {shortHash}
              </span>
            )}
            {s.author && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">
                <UserRound size={12} /> {s.author}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <div ref={scrollRef} className="h-full min-w-0 overflow-y-auto">
          <div className="mx-auto max-w-5xl space-y-1 px-6 py-6">
            {messages.length === 0 && (
              <p className="px-4 py-12 text-center text-sm text-slate-400">开始对话吧</p>
            )}
            {messages.map((m) => (
              <Message key={m.id} message={m} />
            ))}
            {busy && (
              <div className="flex items-center gap-2 px-5 py-2 text-xs text-slate-500">
                <Loader2 size={13} className="animate-spin" /> Agent 思考中…
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-sky-100 bg-white/95 p-4 shadow-[0_-8px_30px_rgba(15,23,42,0.04)]">
        <div className="mx-auto max-w-3xl space-y-2">
          <div className="flex min-h-6 flex-wrap items-center justify-center gap-2 text-[11px] text-slate-500">
            {s.repository && (
              <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-sky-50 px-2 py-1 text-sky-700">
                <FolderGit2 size={12} /> {s.repository.path}
              </span>
            )}
            {branchText && (
              <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-1 text-teal-700">
                <GitBranch size={12} /> {branchText}
              </span>
            )}
            {(shortHash || s.author) && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-slate-700">
                {shortHash && <span className="font-mono">{shortHash}</span>}
                {shortHash && s.author ? <span className="text-slate-400">·</span> : null}
                {s.author}
              </span>
            )}
          </div>
          <div className="flex items-end gap-2">
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
              className="max-h-40 flex-1 resize-none rounded-xl border border-sky-100 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
            />
            <button
              onClick={submit}
              disabled={busy || !input.trim()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-600 text-white shadow-sm shadow-teal-700/20 transition-[background-color,transform] hover:bg-teal-700 active:scale-95 disabled:opacity-40"
            >
              <SendHorizontal size={17} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
