import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import type { SessionListItem } from '../lib/types';

export function useSidebarSessions(refreshKey?: number) {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    return api<{ sessions: SessionListItem[] }>('/api/sessions')
      .then((data) => {
        setSessions(data.sessions);
        setLoadError(null);
      })
      .catch((e) => {
        setLoadError(e instanceof Error ? e.message : '加载失败');
      })
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    const events = new EventSource('/api/sessions/events');
    events.addEventListener('changed', () => {
      void load();
    });
    return () => events.close();
  }, [load]);

  const deleteSession = useCallback(
    (sessionId: string) => {
      return api(`/api/sessions/${sessionId}`, { method: 'DELETE' })
        .then(load)
        .then(() => toast.success('已删除会话'));
    },
    [load],
  );

  return { sessions, loadError, loaded, load, deleteSession };
}
