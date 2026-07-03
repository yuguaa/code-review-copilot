import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('chat route streaming persistence', () => {
  it('uses the UI message stream end callback to persist interactive follow-ups', () => {
    const routeSource = readFileSync(new URL('./chat.ts', import.meta.url), 'utf8');
    const serviceSource = readFileSync(new URL('../modules/chat/chat.service.ts', import.meta.url), 'utf8');

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
