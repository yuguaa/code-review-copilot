import 'dotenv/config';
import { serve } from '@hono/node-server';
import { appConfig } from './config/app.config';
import { createLogger } from './shared/logger/logger.service';
import { createApp } from './app';

const log = createLogger('server');
const app = createApp();

serve({ fetch: app.fetch, port: appConfig.port }, (info) => {
  log.info(`server listening on http://localhost:${info.port}`);
});
