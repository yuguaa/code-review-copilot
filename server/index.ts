import 'dotenv/config';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { requireAuth } from './common/guards/auth.guard';
import { authRoutes } from './modules/auth/auth.routes';
import { chatRoutes } from './modules/chat/chat.routes';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes';
import { repositoryRoutes } from './modules/repositories/repositories.routes';
import { sessionRoutes } from './modules/sessions/sessions.routes';
import { settingsRoutes } from './modules/settings/settings.routes';
import { webhookRoutes } from './modules/webhook/webhook.routes';
import { appConfig } from './config/app.config';
import { createLogger } from './shared/logger/logger.service';

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
app.route('/api/dashboard', dashboardRoutes);

// 生产环境托管 Vite 静态产物（SPA 回退到 index.html）
if (appConfig.isProduction) {
  app.use('/*', serveStatic({ root: './dist/web' }));
  app.get('/*', serveStatic({ path: './dist/web/index.html' }));
}

serve({ fetch: app.fetch, port: appConfig.port }, (info) => {
  log.info(`server listening on http://localhost:${info.port}`);
});
