import { describe, expect, it } from 'vitest';
import { publishSessionListChanged, publishSessionMessages, subscribeSessionEvents, subscribeSessionListEvents } from './session-events';
import type { UIMessage } from 'ai';

describe('session events', () => {
  it('publishes message snapshots to session subscribers', async () => {
    const reader = subscribeSessionEvents('session-1').getReader();
    await reader.read();

    const messages: UIMessage[] = [{ id: 'm1', role: 'assistant', parts: [{ type: 'text', text: '审查结果' }] }];
    publishSessionMessages('session-1', messages);

    const chunk = await reader.read();
    const text = new TextDecoder().decode(chunk.value);

    expect(text).toContain('event: messages');
    expect(text).toContain('审查结果');

    await reader.cancel();
  });

  it('publishes list changed events', async () => {
    const reader = subscribeSessionListEvents().getReader();
    await reader.read();

    publishSessionListChanged();

    const chunk = await reader.read();
    const text = new TextDecoder().decode(chunk.value);

    expect(text).toContain('event: changed');

    await reader.cancel();
  });
});
