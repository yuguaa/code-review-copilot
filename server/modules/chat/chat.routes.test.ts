import { describe, expect, it } from 'vitest';

import { chatRoutes } from './chat.routes';

describe('聊天入口', () => {
  it('无效 JSON 和空会话标识返回 400', () => Promise.all([
    chatRoutes.request('/', { method: 'POST', body: '{' }),
    chatRoutes.request('/', { method: 'POST', body: JSON.stringify({ sessionId: '', messages: [] }) }),
  ]).then((responses) => expect(responses.map((response) => response.status)).toEqual([400, 400])));
});
