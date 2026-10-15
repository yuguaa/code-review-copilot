import { useParams } from 'react-router-dom';
import { CircleAlertIcon } from 'lucide-react';
import { useSessionDetail } from '@web/hooks/useSessionDetail';
import { useChatThreadController } from '@web/hooks/useChatThreadController';
import { ShellHeader } from '@web/components/layout/shell-header';
import { Badge } from '@web/components/ui/badge';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@web/components/ai-elements/conversation';
import { Loader } from '@web/components/ai-elements/loader';
import { ChatComposer } from '@web/components/chat/chat-composer';
import { ChatMessage } from '@web/components/chat/chat-message';
import { ReviewActivityCard, ReviewPendingNotice } from '@web/components/chat/review-activity-card';
import { isReviewActivityPart } from '@web/components/message/message-types';
import { sessionStatusLabel } from '@web/lib/session-format';
import type { SessionDetail } from '@web/lib/types';

export function Chat() {
  const { sessionId } = useParams();
  return sessionId ? <ChatSession key={sessionId} sessionId={sessionId} /> : <ChatPlaceholder />;
}

function ChatPlaceholder() {
  return (
    <>
      <ShellHeader title="代码审查" meta="等待选择会话" />
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h2 className="text-base font-medium">从一个具体问题开始</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Webhook 触发的审查会沉淀成会话；也可以新建对话，追问某个仓库的实现细节。
          </p>
        </div>
      </div>
    </>
  );
}

function ChatSession({ sessionId }: { sessionId: string }) {
  const { detail, error, setDetail } = useSessionDetail(sessionId);

  if (error) {
    return (
      <>
        <ShellHeader title="会话加载失败" />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <CircleAlertIcon className="size-5 text-destructive" />
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </>
    );
  }

  if (!detail) {
    return (
      <>
        <ShellHeader title="加载中…" />
        <div className="flex flex-1 items-center justify-center">
          <Loader size={18} />
        </div>
      </>
    );
  }

  return <ChatThread detail={detail} updateDetail={setDetail} />;
}

function ChatThread({
  detail,
  updateDetail,
}: {
  detail: SessionDetail;
  updateDetail: React.Dispatch<React.SetStateAction<SessionDetail | null>>;
}) {
  const controller = useChatThreadController({ detail, updateDetail });
  const session = detail.session;
  const reviewing = controller.reviewing;

  const latestActivity = controller.messages
    .flatMap((message) => message.parts)
    .filter(isReviewActivityPart)
    .at(-1)?.data;

  const isTriggerFirst = session.kind === 'review' && controller.messages[0]?.role === 'user';
  const title = session.mrTitle || session.title || '代码审查';
  const meta = [
    session.repository?.name || session.repository?.path?.split('/').pop() || null,
    session.sourceBranch && session.targetBranch
      ? `${session.sourceBranch} → ${session.targetBranch}`
      : session.sourceBranch ?? session.targetBranch,
    session.author,
  ]
    .filter(Boolean)
    .join(' · ');

  const placeholder = reviewing
    ? '审查进行中，完成后即可追问…'
    : controller.parentMessageId
      ? '从选中的消息继续追问…（Enter 发送，Shift+Enter 换行）'
      : '继续追问这次审查…（Enter 发送，Shift+Enter 换行）';

  return (
    <>
      <ShellHeader title={title} meta={meta}>
        <Badge variant={session.status === 'failed' ? 'destructive' : 'secondary'}>
          {sessionStatusLabel[session.status] ?? session.status}
        </Badge>
      </ShellHeader>

      <div className="flex min-h-0 flex-1 flex-col">
        {latestActivity ? (
          <div className="shrink-0 px-3 pt-3 sm:px-4">
            <div className="mx-auto w-full max-w-3xl">
              <ReviewActivityCard key={latestActivity.runId} data={latestActivity} />
            </div>
          </div>
        ) : null}
        {!latestActivity && reviewing ? (
          <div className="shrink-0 px-3 pt-3 sm:px-4">
            <div className="mx-auto w-full max-w-3xl">
              <ReviewPendingNotice onStop={controller.stopReview} stopping={controller.stoppingReview} />
            </div>
          </div>
        ) : null}

        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="mx-auto w-full max-w-3xl gap-5 px-3 py-4 sm:px-4">
            {controller.messages.map((message, index) => (
              <ChatMessage
                key={message.id}
                message={message}
                isTrigger={isTriggerFirst && index === 0}
                streaming={
                  controller.status === 'streaming' &&
                  index === controller.messages.length - 1 &&
                  message.role === 'assistant'
                }
                branch={controller.treeById.get(message.id)}
                onSelectSibling={controller.switchToMessage}
                onBranchFrom={reviewing ? undefined : controller.branchFromMessage}
                onFeedback={reviewing ? undefined : controller.submitFeedback}
              />
            ))}
            {controller.status === 'submitted' && controller.messages.at(-1)?.role !== 'assistant' ? (
              <Loader size={16} />
            ) : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <ChatComposer
          status={controller.status}
          disabled={controller.busy || reviewing}
          placeholder={placeholder}
          modelOptions={controller.modelOptions}
          modelsLoading={controller.modelsLoading}
          selectedModelId={controller.selectedAIModelId}
          onModelChange={controller.setSelectedAIModelId}
          onSubmit={controller.submit}
          onStop={controller.stop}
          canRunReview={controller.canRunReviewCommand}
          runningReview={controller.commandRunning}
          onRunReview={controller.runReviewCommand}
        />
      </div>
    </>
  );
}
