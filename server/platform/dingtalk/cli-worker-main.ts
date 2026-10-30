import { serve } from '@hono/node-server';

import { createDingtalkWorker } from './cli-worker';
import { createDwsLoginManager } from './cli-login';
import { runDws } from './cli-runtime';

const login = createDwsLoginManager();
const server = serve({ fetch: createDingtalkWorker(process.env.DINGTALK_WORKER_TOKEN ?? '', runDws, login).fetch, port: 8791 });
const stop = () => { server.close(); void login.stop().then(() => process.exit()); };
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
