import { Hono } from 'hono';
import { proxy } from 'hono/proxy';

import { requireAuth } from '../../common/guards/auth.guard';

export const observabilityRoutes = new Hono();

const GRAFANA_ORIGIN = 'http://grafana:3000';

observabilityRoutes.use('*', requireAuth);
observabilityRoutes.all('*', (c) => {
  const incoming = new URL(c.req.url);
  const target = new URL(GRAFANA_ORIGIN);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  /* 只转发业务请求头，身份完全来自本次数据库会话校验。 */
  const headers = new Headers();
  for (const name of ['accept', 'accept-language', 'content-type', 'content-length', 'user-agent', 'x-dashboard-uid', 'x-panel-id']) {
    const value = c.req.header(name);
    if (value) headers.set(name, value);
  }
  headers.set('X-WEBAUTH-USER', c.get('authUsername'));
  headers.set('X-WEBAUTH-ROLE', 'Admin');
  return proxy(target, { raw: c.req.raw, headers, redirect: 'manual' }).then((response) => {
    response.headers.delete('set-cookie');
    response.headers.set('Cache-Control', 'no-store');
    return response;
  });
});
