import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { requireAuth } from './common/guards/auth.guard';
import { appConfig } from './config/app.config';
import { authRoutes } from './modules/auth/auth.routes';
import { chatRoutes } from './modules/chat/chat.routes';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes';
import { repositoryRoutes } from './modules/repositories/repositories.routes';
import { sessionRoutes } from './modules/sessions/sessions.routes';
import { settingsRoutes } from './modules/settings/settings.routes';
import { webhookRoutes } from './modules/webhook/webhook.routes';

export function createApp() {
  const app = new Hono();

  app.use('*', honoLogger());
  app.use('/api/*', cors({ origin: (origin) => origin, credentials: true }));

  app.get('/healthz', (context) => context.text('ok'));

  app.use('/api/*', requireAuth);

  app.route('/api/auth', authRoutes);
  app.route('/api/sessions', sessionRoutes);
  app.route('/api/repositories', repositoryRoutes);
  app.route('/api/settings', settingsRoutes);
  app.route('/api/chat', chatRoutes);
  app.route('/api/webhook', webhookRoutes);
  app.route('/api/dashboard', dashboardRoutes);

  if (appConfig.isProduction) {
    app.use('/*', serveStatic({ root: './dist/web' }));
    app.get('/*', serveStatic({ path: './dist/web/index.html' }));
  }

  return app;
}
