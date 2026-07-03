import { useEffect, useRef } from 'react';
import type { UIMessage } from 'ai';
import type { SessionDetail } from '../lib/types';

type MessagePayload = Partial<Pick<SessionDetail, 'messages' | 'messageTree' | 'activeLeafMessageId' | 'activePathIds'>>;

type UseChatSessionEventsOptions = {
  busy: boolean;
  sessionId: string;
  setMessages: (messages: UIMessage[]) => void;
  updateDetail: React.Dispatch<React.SetStateAction<SessionDetail | null>>;
  onActivity: () => void;
};

export function useChatSessionEvents({ busy, sessionId, setMessages, updateDetail, onActivity }: UseChatSessionEventsOptions) {
  const busyRef = useRef(false);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    const events = new EventSource(`/api/sessions/${sessionId}/events`);

    events.addEventListener('messages', (event) => {
      // 本地追问流式进行中时忽略服务端回显，避免两个来源双写造成重复/闪跳；
      // 该通道只服务后台 webhook 审查（页面被动旁观，此时非 busy）。
      if (busyRef.current) return;
      const payload = JSON.parse((event as MessageEvent<string>).data) as MessagePayload;
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
}
