import { describe, expect, it } from 'vitest';
import {
  publishSessionError,
  publishSessionListChanged,
  publishSessionMessages,
  publishSessionStatus,
  subscribeSessionEvents,
  subscribeSessionListEvents,
} from './session-events.service';
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

  it('为慢订阅者合并消息快照，并保留错误与状态事件顺序', async () => {
    const reader = subscribeSessionEvents('session-slow').getReader();
    await reader.read();

    const message = (id: string): UIMessage[] => [{ id, role: 'assistant', parts: [{ type: 'text', text: id }] }];
    publishSessionMessages('session-slow', message('snapshot-1'));
    publishSessionMessages('session-slow', message('snapshot-2'));
    publishSessionError('session-slow', '审查失败');
    publishSessionStatus('session-slow', 'failed');
    publishSessionMessages('session-slow', message('snapshot-3'));

    const first = new TextDecoder().decode((await reader.read()).value);
    const error = new TextDecoder().decode((await reader.read()).value);
    const status = new TextDecoder().decode((await reader.read()).value);
    const latest = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain('snapshot-1');
    expect(error).toContain('event: review-error');
    expect(error).toContain('审查失败');
    expect(status).toContain('event: status');
    expect(status).toContain('failed');
    expect(latest).toContain('snapshot-3');
    expect(latest).not.toContain('snapshot-2');

    await reader.cancel();
  });
});
