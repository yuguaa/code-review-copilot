import { useCallback, useEffect, useRef, useState } from 'react';

type UseChatAutoScrollOptions = {
  busy: boolean;
  messages: unknown[];
  sessionId: string;
  status: string;
};

export function useChatAutoScroll({ busy, messages, sessionId, status }: UseChatAutoScrollOptions) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const [scrollState, setScrollState] = useState({ top: true, bottom: true, scrollable: false });

  const markNearBottom = useCallback(() => {
    nearBottomRef.current = true;
  }, []);

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

  return { scrollRef, scrollState, markNearBottom, syncScrollState };
}
