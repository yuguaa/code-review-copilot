import { useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert';
import type { SessionDetail } from '../lib/types';
import { Sidebar } from '../components/Sidebar';
import { ChatHeader } from '../components/chat/ChatHeader';
import { LazyComposer } from '../components/chat/LazyComposer';
import { MessageList } from '../components/chat/MessageList';
import { useSessionDetail } from '../hooks/useSessionDetail';
import { useChatThreadController } from '../hooks/useChatThreadController';

export function Chat() {
  const { sessionId } = useParams();
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="review-workbench line-canvas flex h-full min-h-0 overflow-x-hidden max-md:flex-col">
      <Sidebar refreshKey={refreshKey} />
      <main className="chat-main relative flex min-h-0 min-w-0 flex-1 flex-col">
        {sessionId ? (
          <ChatView key={sessionId} sessionId={sessionId} onActivity={() => setRefreshKey((k) => k + 1)} />
        ) : (
          <ChatEmptyState />
        )}
      </main>
    </div>
  );
}

function ChatEmptyState() {
  const rootRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      const timeline = gsap.timeline({ defaults: { ease: 'power3.out' } });
      timeline
        .fromTo(
          '[data-empty-shell]',
          { y: 18, scale: 0.985 },
          {
            y: 0,
            scale: 1,
            duration: 0.62,
            clearProps: 'transform',
          },
        )
        .fromTo(
          '[data-empty-copy]',
          { y: 16, filter: 'blur(4px)' },
          {
            y: 0,
            filter: 'blur(0px)',
            duration: 0.56,
            stagger: 0.06,
            clearProps: 'transform,filter',
          },
          '-=0.34',
        )
        .fromTo(
          '[data-empty-step]',
          { x: 18 },
          {
            x: 0,
            duration: 0.46,
            stagger: 0.08,
            clearProps: 'transform',
          },
          '-=0.34',
        );

      gsap.to('[data-empty-dot]', {
        scale: 1.65,
        opacity: 0.36,
        duration: 1.2,
        repeat: -1,
        yoyo: true,
        stagger: 0.18,
        ease: 'sine.inOut',
      });
    },
    { scope: rootRef },
  );

  return (
    <div ref={rootRef} className="measure-rails grid h-full place-items-center px-6 py-10">
      <div data-empty-shell className="technical-panel grid w-full max-w-3xl gap-8 rounded-[var(--r-xl)] bg-[var(--surface-card)] p-8 shadow-[var(--shadow-lg)] ring-1 ring-white/80 max-md:p-6 md:grid-cols-[1fr_0.72fr]">
        <div className="min-w-0">
          <div data-empty-copy className="flex h-14 w-14 items-center justify-center rounded-[var(--r-lg)] bg-[var(--primary)] text-white shadow-[var(--shadow-sm)]">
            <MessageSquare size={23} />
          </div>
          <p data-empty-copy className="font-display mt-8 max-w-lg text-[34px] leading-[1.04] text-[var(--ink)] max-sm:text-[28px]">
            选择一次审查，继续追问上下文
          </p>
          <p data-empty-copy className="mt-4 max-w-md text-sm leading-relaxed text-[var(--muted)]">
            Webhook 触发的审查会沉淀成会话。你可以追问风险原因、改动范围、分支差异，也可以从任意消息分叉继续。
          </p>
        </div>
        <div className="grid content-end gap-3">
          {['MR 触发', 'Agent 审查', '结论沉淀'].map((item) => (
            <div
              key={item}
              data-empty-step
              className="flex items-center justify-between rounded-[var(--r-md)] bg-[var(--surface-soft)] px-4 py-3 text-sm text-[var(--body-strong)] ring-1 ring-[var(--hairline)]"
            >
              <span>{item}</span>
              <span data-empty-dot className="h-2 w-2 rounded-full bg-[var(--accent)]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ChatView({ sessionId, onActivity }: { sessionId: string; onActivity: () => void }) {
  const { detail, error, setDetail } = useSessionDetail(sessionId);

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
  const {
    branchFromMessage,
    busy,
    canRunReviewCommand,
    commandRunning,
    messages,
    parentMessageId,
    reviewing,
    runReviewCommand,
    scroll,
    status,
    stop,
    submit,
    submitFeedback,
    switchToMessage,
    treeById,
  } = useChatThreadController({ detail, onActivity, updateDetail });
  const s = detail.session;
  const composerCommands = useMemo(
    () => [
      {
        id: 'review-command',
        title: '代码审查指令',
        description: '重新执行当前 review，完成后按仓库配置发送钉钉或 GitLab 评论。',
        disabled: !canRunReviewCommand || commandRunning,
        loading: commandRunning,
        onSelect: runReviewCommand,
      },
    ],
    [canRunReviewCommand, commandRunning, runReviewCommand],
  );

  return (
    <>
      <ChatHeader session={s} />

      <div
        className={[
          'conversation-frame min-h-0 flex-1',
          scroll.scrollState.scrollable && !scroll.scrollState.top ? 'is-scrolled' : '',
          scroll.scrollState.scrollable && !scroll.scrollState.bottom ? 'can-scroll-more' : '',
        ].join(' ')}
      >
        <div ref={scroll.scrollRef} onScroll={scroll.syncScrollState} className="conversation-scroll h-full min-w-0 overflow-y-auto">
          <MessageList
            session={s}
            messages={messages}
            status={status}
            busy={busy}
            reviewing={reviewing}
            treeById={treeById}
            onSelectSibling={switchToMessage}
            onBranchFrom={branchFromMessage}
            onFeedback={submitFeedback}
          />
        </div>
      </div>

      <div className="composer-dock z-10 px-4 py-4 max-md:px-3 max-md:py-3">
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
            commands={composerCommands}
          />
        </div>
      </div>
    </>
  );
}
