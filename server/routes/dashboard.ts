import { Hono } from 'hono';
import { loadDashboardPayload } from '../modules/dashboard/dashboard.service';

export const dashboardRoutes = new Hono();

dashboardRoutes.get('/', async (c) => {
  return c.json(await loadDashboardPayload());
});
