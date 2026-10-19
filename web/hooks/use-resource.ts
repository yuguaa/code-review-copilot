import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@web/lib/api';

export function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const revision = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const reload = useCallback(() => {
    controller.current?.abort();
    const requestRevision = ++revision.current;
    if (!path) { setLoading(false); return Promise.resolve(); }
    const requestController = new AbortController();
    controller.current = requestController;
    setLoading(true);
    setError(null);
    return api<T>(path, { signal: requestController.signal }).then((next) => {
      if (requestRevision === revision.current) { setData(next); setLoadedPath(path); return next; }
    }).catch((reason: unknown) => {
      if (requestRevision === revision.current && reason instanceof Error && reason.name !== 'AbortError') setError(reason.message);
    }).finally(() => {
      if (requestRevision === revision.current) setLoading(false);
    });
  }, [path]);
  useEffect(() => {
    setData(null);
    void reload();
    return () => { ++revision.current; controller.current?.abort(); };
  }, [reload]);
  return { data: loadedPath === path ? data : null, error, loading, reload, setData };
}

export function useAction() {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const execute = (key: string, action: () => Promise<unknown>) => {
    if (active.current) return;
    active.current = true;
    setPending(key);
    setError(null);
    void Promise.resolve().then(action).catch((reason: unknown) => {
      if (reason instanceof Error && reason.name === 'AbortError') return;
      setError(reason instanceof Error ? reason.message : '操作失败');
    }).finally(() => {
      active.current = false;
      setPending(null);
    });
  };
  return { pending, error, execute };
}
