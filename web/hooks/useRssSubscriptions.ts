import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import type { RssSubscriptionItem } from '../lib/types';

export function useRssSubscriptions() {
  const [subscriptions, setSubscriptions] = useState<RssSubscriptionItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    return api<{ subscriptions: RssSubscriptionItem[] }>('/api/rss/subscriptions')
      .then((data) => setSubscriptions(data.subscriptions))
      .catch((error) => toast.error(error instanceof Error ? error.message : '订阅列表加载失败'))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { subscriptions, loaded, load };
}
