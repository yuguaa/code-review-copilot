import { LoaderCircleIcon } from 'lucide-react';

import { Badge } from '@web/components/ui/badge';
import { activeRunStatuses, runStatusLabels } from '@web/lib/run-format';

import type { RunStatus } from '@web/lib/types';

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return <Badge variant={['failed', 'interrupted'].includes(status) ? 'destructive' : status === 'completed' ? 'default' : 'secondary'}>{activeRunStatuses.has(status) && <LoaderCircleIcon className="size-3 animate-spin" />}{runStatusLabels[status]}</Badge>;
}
