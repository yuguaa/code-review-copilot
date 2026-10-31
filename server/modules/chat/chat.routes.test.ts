import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { chatRoutes } from './chat.routes';

describe('聊天入口', () => {
  const authenticatedRoutes = new Hono().use('*', (c, next) => { c.set('authUsername', 'authenticated-tester'); return next(); }).route('/', chatRoutes);

  it('无效 JSON 和空会话标识返回 400', () => Promise.all([
    authenticatedRoutes.request('/', { method: 'POST', body: '{' }),
    authenticatedRoutes.request('/', { method: 'POST', body: JSON.stringify({ sessionId: '', messages: [] }) }),
  ]).then((responses) => expect(responses.map((response) => response.status)).toEqual([400, 400])));
});
