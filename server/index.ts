import 'dotenv/config';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { requireAuth } from './middleware/auth';
import { authRoutes } from './routes/auth';
import { sessionRoutes } from './routes/sessions';
import { repositoryRoutes } from './routes/repositories';
import { settingsRoutes } from './routes/settings';
import { chatRoutes } from './routes/chat';
import { webhookRoutes } from './routes/webhook';
import { createLogger } from './lib/logger';

const log = createLogger('server');
const app = new Hono();

app.use('*', honoLogger());
app.use('/api/*', cors({ origin: (o) => o, credentials: true }));

// 健康检查（公开）
app.get('/healthz', (c) => c.text('ok'));

// 全局鉴权守卫：所有 /api/* 必过（login 与 webhook 在中间件内放行）
app.use('/api/*', requireAuth);

// API 路由
app.route('/api/auth', authRoutes);
app.route('/api/sessions', sessionRoutes);
app.route('/api/repositories', repositoryRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/chat', chatRoutes);
app.route('/api/webhook', webhookRoutes);

// 生产环境托管 Vite 静态产物（SPA 回退到 index.html）
if (process.env.NODE_ENV === 'production') {
  app.use('/*', serveStatic({ root: './dist/web' }));
  app.get('/*', serveStatic({ path: './dist/web/index.html' }));
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  log.info(`server listening on http://localhost:${info.port}`);
});
