import { useCallback, useMemo, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { toast } from 'sonner';
import { api } from '../lib/api';
import type { MessageFeedbackValue, SessionDetail } from '../lib/types';
import { useChatAutoScroll } from './useChatAutoScroll';
import { useChatSessionEvents } from './useChatSessionEvents';

type MessageTreePayload = Pick<SessionDetail, 'messages' | 'messageTree' | 'activeLeafMessageId' | 'activePathIds'>;

function mergeMessageTree(current: SessionDetail | null, next: MessageTreePayload): SessionDetail | null {
  return current
    ? {
        ...current,
        messages: next.messages,
        messageTree: next.messageTree,
        activeLeafMessageId: next.activeLeafMessageId,
        activePathIds: next.activePathIds,
      }
    : current;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useChatThreadController({
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
  const [stoppingReview, setStoppingReview] = useState(false);
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

  const busy = status === 'submitted' || status === 'streaming';
  const scroll = useChatAutoScroll({ busy, messages, sessionId, status });
  const { markNearBottom } = scroll;
  useChatSessionEvents({ busy, sessionId, setMessages, updateDetail, onActivity });

  const session = detail.session;
  const reviewing = session.status === 'running';
  const composerDisabled = busy || reviewing;
  const treeById = useMemo(() => new Map(detail.messageTree.map((node) => [node.id, node])), [detail.messageTree]);
  const canRunReviewCommand = session.kind === 'review' && !busy && !reviewing;

  const submit = useCallback((text: string) => {
    if (!text || composerDisabled) return;
    markNearBottom();
    void sendMessage({ text }, { body: { parentMessageId } });
  }, [composerDisabled, markNearBottom, parentMessageId, sendMessage]);

  const runReviewCommand = useCallback(() => {
    if (!canRunReviewCommand || commandRunning) return;
    setCommandRunning(true);
    setParentMessageId(null);
    markNearBottom();
    api<MessageTreePayload>(`/api/sessions/${sessionId}/review-command`, { method: 'POST' })
      .then((next) => {
        setMessages(next.messages);
        updateDetail((current) => {
          const merged = mergeMessageTree(current, next);
          return merged ? { ...merged, session: { ...merged.session, status: 'running', error: null } } : merged;
        });
        onActivity();
        toast.success('已重新执行代码审查');
      })
      .catch((e) => toast.error(errorMessage(e, '代码审查指令执行失败')))
      .finally(() => setCommandRunning(false));
  }, [canRunReviewCommand, commandRunning, markNearBottom, onActivity, sessionId, setMessages, updateDetail]);

  const stopReview = useCallback(() => {
    if (!reviewing || stoppingReview) return;
    setStoppingReview(true);
    api<{ error?: string }>(`/api/sessions/${sessionId}/stop-review`, { method: 'POST' })
      .then((result) => {
        updateDetail((current) =>
          current
            ? {
                ...current,
                session: {
                  ...current.session,
                  status: 'failed',
                  error: result.error ?? '用户手动停止审查',
                },
              }
            : current,
        );
        onActivity();
        toast.success('已停止审查');
        api<SessionDetail>(`/api/sessions/${sessionId}`)
          .then((next) => {
            updateDetail(next);
            setMessages(next.messages);
          })
          .catch(() => undefined);
      })
      .catch((e) => toast.error(errorMessage(e, '停止审查失败')))
      .finally(() => setStoppingReview(false));
  }, [onActivity, reviewing, sessionId, stoppingReview, updateDetail]);

  const switchToMessage = useCallback((messageId: string) => {
    if (busy) return;
    api<MessageTreePayload>(`/api/sessions/${sessionId}/active-message`, {
      method: 'POST',
      body: JSON.stringify({ messageId }),
    })
      .then((next) => {
        setMessages(next.messages);
        updateDetail((current) => mergeMessageTree(current, next));
      })
      .catch((e) => toast.error(errorMessage(e, '切换分支失败')));
  }, [busy, sessionId, setMessages, updateDetail]);

  const branchFromMessage = useCallback((messageId: string) => {
    if (busy) return;
    const message = messages.find((item) => item.id === messageId);
    if (message?.role === 'user') {
      markNearBottom();
      setParentMessageId(null);
      regenerate({ messageId, body: { parentMessageId: messageId } }).catch((e) =>
        toast.error(errorMessage(e, '重新回答失败')),
      );
      return;
    }
    setParentMessageId(messageId);
  }, [busy, markNearBottom, messages, regenerate]);

  const submitFeedback = useCallback((messageId: string, feedback: MessageFeedbackValue, findingText?: string) => {
    if (busy) return;
    api<MessageTreePayload>(`/api/sessions/${sessionId}/message-feedback`, {
      method: 'POST',
      body: JSON.stringify({ messageId, feedback, findingText }),
    })
      .then((next) => {
        setMessages(next.messages);
        updateDetail((current) => mergeMessageTree(current, next));
        toast.success(
          findingText
            ? feedback === 'up'
              ? '已标记为真实问题，后续审查会参考'
              : '已标记为误报，后续审查会降低同类结论权重'
            : feedback === 'up'
              ? '已记录认可，后续审查会参考'
              : '已记录否定，后续审查会避开',
        );
      })
      .catch((e) => toast.error(errorMessage(e, '反馈提交失败')));
  }, [busy, sessionId, setMessages, updateDetail]);

  return {
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
    stopReview,
    stoppingReview,
    submit,
    submitFeedback,
    switchToMessage,
    treeById,
  };
}
