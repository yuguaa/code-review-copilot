import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import {
  Loader2,
  MessageSquare,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import type { SessionDetail } from '../lib/types';
import { Sidebar } from '../components/Sidebar';
import { ChatHeader } from '../components/chat/ChatHeader';
import { LazyComposer } from '../components/chat/LazyComposer';
import { MessageList } from '../components/chat/MessageList';

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
            <div className="flex h-16 w-16 items-center justify-center rounded-[var(--r-xl)] bg-[var(--brand-lime)] text-[var(--ink)]">
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
  const [parentMessageId, setParentMessageId] = useState<string | null>(null);
  const [commandRunning, setCommandRunning] = useState(false);
  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/chat', body: { sessionId } }),
    [sessionId],
  );
  const { messages, setMessages, sendMessage, regenerate, stop, status } = useChat({
    id: sessionId,
    messages: detail.messages,
    transport,
    onFinish: () => {
      setParentMessageId(null);
      onActivity();
      api<SessionDetail>(`/api/sessions/${sessionId}`)
        .then((next) => {
          updateDetail(next);
          setMessages(next.messages);
        })
        .catch(() => undefined);
    },
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const [scrollState, setScrollState] = useState({ top: true, bottom: true, scrollable: false });
  const busy = status === 'submitted' || status === 'streaming';
  // 交互追问期间，useChat 独占 messages；用 ref 让 SSE 监听闭包读到实时 busy
  const busyRef = useRef(false);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

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
    const events = new EventSource(`/api/sessions/${sessionId}/events`);

    events.addEventListener('messages', (event) => {
      // 本地追问流式进行中时忽略服务端回显，避免两个来源双写造成重复/闪跳；
      // 该通道只服务后台 webhook 审查（页面被动旁观，此时非 busy）。
      if (busyRef.current) return;
      const payload = JSON.parse((event as MessageEvent<string>).data) as Partial<
        Pick<SessionDetail, 'messages' | 'messageTree' | 'activeLeafMessageId' | 'activePathIds'>
      >;
      if (payload.messageTree) {
        updateDetail((current) =>
          current
            ? {
                ...current,
                messages: payload.messages ?? current.messages,
                messageTree: payload.messageTree ?? current.messageTree,
                activeLeafMessageId: payload.activeLeafMessageId ?? current.activeLeafMessageId,
                activePathIds: payload.activePathIds ?? current.activePathIds,
              }
            : current,
        );
      }
      if (!payload.messages) return;
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
  const treeById = useMemo(() => new Map(detail.messageTree.map((node) => [node.id, node])), [detail.messageTree]);
  const canRunReviewCommand = s.kind === 'review' && !busy && !reviewing;

  const submit = (text: string) => {
    if (!text || composerDisabled) return;
    nearBottomRef.current = true;
    void sendMessage({ text }, { body: { parentMessageId } });
  };

  const runReviewCommand = () => {
    if (!canRunReviewCommand || commandRunning) return;
    setCommandRunning(true);
    setParentMessageId(null);
    nearBottomRef.current = true;
    api<Pick<SessionDetail, 'messages' | 'messageTree' | 'activeLeafMessageId' | 'activePathIds'>>(
      `/api/sessions/${sessionId}/review-command`,
      { method: 'POST' },
    )
      .then((next) => {
        setMessages(next.messages);
        updateDetail((current) =>
          current
            ? {
                ...current,
                session: { ...current.session, status: 'running', error: null },
                messages: next.messages,
                messageTree: next.messageTree,
                activeLeafMessageId: next.activeLeafMessageId,
                activePathIds: next.activePathIds,
              }
            : current,
        );
        onActivity();
        toast.success('已重新执行代码审查');
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : '代码审查指令执行失败'))
      .finally(() => setCommandRunning(false));
  };

  const switchToMessage = (messageId: string) => {
    if (busy) return;
    api<Pick<SessionDetail, 'messages' | 'messageTree' | 'activeLeafMessageId' | 'activePathIds'>>(`/api/sessions/${sessionId}/active-message`, {
      method: 'POST',
      body: JSON.stringify({ messageId }),
    })
      .then((next) => {
        setMessages(next.messages);
        updateDetail((current) =>
          current
            ? {
                ...current,
                messages: next.messages,
                messageTree: next.messageTree,
                activeLeafMessageId: next.activeLeafMessageId,
                activePathIds: next.activePathIds,
              }
            : current,
        );
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : '切换分支失败'));
  };

  const branchFromMessage = (messageId: string) => {
    if (busy) return;
    const message = messages.find((item) => item.id === messageId);
    if (message?.role === 'user') {
      nearBottomRef.current = true;
      setParentMessageId(null);
      regenerate({ messageId, body: { parentMessageId: messageId } }).catch((e) =>
        toast.error(e instanceof Error ? e.message : '重新回答失败'),
      );
      return;
    }
    setParentMessageId(messageId);
  };

  return (
    <>
      <ChatHeader session={s} />

      <div
        className={[
          'conversation-frame min-h-0 flex-1',
          scrollState.scrollable && !scrollState.top ? 'is-scrolled' : '',
          scrollState.scrollable && !scrollState.bottom ? 'can-scroll-more' : '',
        ].join(' ')}
      >
        <div ref={scrollRef} onScroll={syncScrollState} className="conversation-scroll h-full min-w-0 overflow-y-auto">
          <MessageList
            session={s}
            messages={messages}
            status={status}
            busy={busy}
            reviewing={reviewing}
            treeById={treeById}
            onSelectSibling={switchToMessage}
            onBranchFrom={branchFromMessage}
          />
        </div>
      </div>

      <div className="z-10 border-t border-[var(--hairline)] bg-[var(--canvas)] p-4 max-md:p-3">
        <div className="mx-auto max-w-4xl">
          <LazyComposer
            placeholder={
              reviewing
                ? '审查进行中，完成后即可追问…'
                : parentMessageId
                  ? '从选中的消息分叉继续…（Enter 发送，Shift+Enter 换行）'
                  : '输入 / 选择指令，或继续追问…'
            }
            disabled={reviewing}
            busy={busy}
            onStop={stop}
            onSubmit={submit}
            commands={[
              {
                id: 'review-command',
                title: '代码审查指令',
                description: '重新执行当前 review，完成后按仓库配置发送钉钉或 GitLab 评论。',
                disabled: !canRunReviewCommand || commandRunning,
                loading: commandRunning,
                onSelect: runReviewCommand,
              },
            ]}
          />
        </div>
      </div>
    </>
  );
}
