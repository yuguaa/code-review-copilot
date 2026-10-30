import { serve } from '@hono/node-server';

import { createDingtalkWorker } from './cli-worker';

serve({ fetch: createDingtalkWorker(process.env.DINGTALK_WORKER_TOKEN ?? '').fetch, port: 8791 });
