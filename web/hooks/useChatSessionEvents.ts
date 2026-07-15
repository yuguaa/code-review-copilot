import { useEffect, useRef } from 'react';
import type { UIMessage } from 'ai';
import { api } from '../lib/api';
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
    let eventRevision = 0;
    let syncRequestId = 0;
    let disposed = false;

    const syncSession = () => {
      const requestId = ++syncRequestId;
      const revisionAtStart = eventRevision;
      api<SessionDetail>(`/api/sessions/${sessionId}`)
        .then((next) => {
          if (disposed || busyRef.current || requestId !== syncRequestId || eventRevision !== revisionAtStart) return;
          updateDetail(next);
          setMessages(next.messages);
        })
        .catch(() => undefined);
    };

    events.addEventListener('open', syncSession);

    events.addEventListener('messages', (event) => {
      eventRevision += 1;
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
      eventRevision += 1;
      const payload = JSON.parse((event as MessageEvent<string>).data) as { status: string };
      updateDetail((current) =>
        current ? { ...current, session: { ...current.session, status: payload.status } } : current,
      );
      if (payload.status !== 'running') {
        onActivity();
        syncSession();
      }
    });

    events.addEventListener('review-error', (event) => {
      eventRevision += 1;
      if (!(event instanceof MessageEvent)) return;
      const payload = JSON.parse(event.data) as { error: string };
      updateDetail((current) =>
        current ? { ...current, session: { ...current.session, error: payload.error } } : current,
      );
    });

    return () => {
      disposed = true;
      events.close();
    };
  }, [onActivity, sessionId, setMessages, updateDetail]);
}
