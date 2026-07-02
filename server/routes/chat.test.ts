import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('chat route streaming persistence', () => {
  it('does not publish message snapshots during interactive follow-up streaming', () => {
    const source = readFileSync(new URL('./chat.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('publishSessionMessages');
    expect(source).toContain('publishSessionListChanged');
  });
});
