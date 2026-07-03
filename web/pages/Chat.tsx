import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Loader2,
  MessageSquare,
  AlertCircle,
} from 'lucide-react';
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
            commands={composerCommands}
          />
        </div>
      </div>
    </>
  );
}
