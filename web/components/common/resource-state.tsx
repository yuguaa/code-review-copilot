import { CircleAlertIcon, InboxIcon } from 'lucide-react';

import { Button } from '@web/components/ui/button';
import { Alert, AlertDescription } from '@web/components/ui/alert';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@web/components/ui/empty';
import { Skeleton } from '@web/components/ui/skeleton';

export function ResourceState({ loading, error, empty, title = '暂无记录', description, retry }: {
  loading?: boolean; error?: string | null; empty?: boolean; title?: string; description?: string; retry?: () => void;
}) {
  if (loading) return <div className="flex flex-col gap-4 p-6" role="status" aria-label="正在加载"><Skeleton className="h-6 w-40" /><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>;
  if (!error && !empty) return null;
  return <Empty className="min-h-60"><EmptyHeader><EmptyMedia variant="icon">{error ? <CircleAlertIcon /> : <InboxIcon />}</EmptyMedia><EmptyTitle>{error ? '加载失败' : title}</EmptyTitle><EmptyDescription>{error || description}</EmptyDescription></EmptyHeader>{error && retry && <Button variant="outline" onClick={retry}>重新加载</Button>}</Empty>;
}

export function ActionError({ error }: { error: string | null }) {
  return error ? <Alert variant="destructive" role="alert"><CircleAlertIcon /><AlertDescription>{error}</AlertDescription></Alert> : null;
}
