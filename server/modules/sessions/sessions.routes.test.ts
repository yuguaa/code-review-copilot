import { describe, expect, it } from 'vitest';

import { sessionRoutes } from './sessions.routes';

describe('会话请求校验', () => {
  it('拒绝无效 JSON 和未知配置字段', () => Promise.all([
    sessionRoutes.request('/', { method: 'POST', body: '{' }),
    sessionRoutes.request('/', { method: 'POST', body: JSON.stringify({ status: 'completed' }) }),
    sessionRoutes.request('/session/active-message', { method: 'POST', body: JSON.stringify({ messageId: '' }) }),
    sessionRoutes.request('/?kind=unknown'),
  ]).then((responses) => expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 400])));

  it('反馈与自动记忆路由已经移除', () => Promise.resolve(sessionRoutes.request('/session/message-feedback', {
    method: 'POST', body: JSON.stringify({ messageId: 'message', feedback: 'up', findingText: '内容' }),
  })).then((response) => expect(response.status).toBe(404)));
});
