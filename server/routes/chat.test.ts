import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('chat route streaming persistence', () => {
  it('uses the UI message stream end callback to persist interactive follow-ups', () => {
    const source = readFileSync(new URL('./chat.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('publishSessionMessages');
    expect(source).not.toContain('consumeSseStream');
    expect(source).toContain('onEnd: async');
    expect(source).toContain('saveMessages(sessionId, visibleMessages)');
    expect(source).toContain('publishSessionListChanged');
  });
});
