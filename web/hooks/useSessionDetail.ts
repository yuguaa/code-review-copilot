import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { SessionDetail } from '../lib/types';

export function useSessionDetail(sessionId: string) {
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

  return { detail, error, setDetail };
}
