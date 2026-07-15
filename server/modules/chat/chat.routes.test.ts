import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prepareChatStreamMock = vi.hoisted(() => vi.fn());

vi.mock('./chat.service', () => ({ prepareChatStream: prepareChatStreamMock }));

import { chatRoutes } from './chat.routes';

beforeEach(() => {
  prepareChatStreamMock.mockReset();
});

describe('chat route streaming persistence', () => {
  it('uses the UI message stream end callback to persist interactive follow-ups', () => {
    const routeSource = readFileSync(new URL('./chat.routes.ts', import.meta.url), 'utf8');
    const serviceSource = readFileSync(new URL('./chat.service.ts', import.meta.url), 'utf8');

    expect(routeSource).not.toContain('publishSessionMessages');
    expect(routeSource).not.toContain('consumeSseStream');
    expect(routeSource).not.toContain('mergePersistedMessages');
    expect(routeSource).toContain('prepareChatStream');
    expect(routeSource).toContain('onEnd: async');
    expect(routeSource).toContain('generateMessageId: randomUUID');
    expect(serviceSource).toContain('mergePersistedMessages(messages, finalMessages)');
    expect(serviceSource).toContain('mergeIncomingUserMessageAtParent');
    expect(serviceSource).toContain('saveMessages(sessionId, visibleMessages)');
    expect(serviceSource).toContain('publishSessionListChanged');
  });
});

describe('chat route model selection', () => {
  it('returns 400 when the selected model is invalid', async () => {
    prepareChatStreamMock.mockResolvedValue({ kind: 'invalid-model', message: '所选模型不存在或已停用' });

    const response = await chatRoutes.request('http://localhost/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1', aiModelId: 'model-1', messages: [] }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: '所选模型不存在或已停用' });
    expect(prepareChatStreamMock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      aiModelId: 'model-1',
      messages: [],
    });
  });
});
