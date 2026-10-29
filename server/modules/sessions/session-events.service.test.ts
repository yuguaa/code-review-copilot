import { describe, expect, it } from 'vitest';
import {
  publishSessionError,
  publishSessionListChanged,
  publishSessionMessages,
  publishSessionProgress,
  publishSessionStatus,
  subscribeSessionEvents,
  subscribeSessionListEvents,
} from './session-events.service';
import type { UIMessage } from 'ai';

describe('session events', () => {
  it('已经取消的请求立即结束订阅', async () => {
    const controller = new AbortController();
    controller.abort();
    const reader = subscribeSessionEvents('already-aborted', controller.signal).getReader();
    expect((await reader.read()).done).toBe(true);
    publishSessionStatus('already-aborted', 'completed');
  });

  it('请求取消后释放订阅，同一会话可以重新连接', async () => {
    const controller = new AbortController();
    const reader = subscribeSessionEvents('aborted', controller.signal).getReader();
    await reader.read();
    controller.abort();
    expect((await reader.read()).done).toBe(true);
    const next = subscribeSessionEvents('aborted').getReader();
    await next.read();
    publishSessionStatus('aborted', 'completed');
    expect(new TextDecoder().decode((await next.read()).value)).toContain('completed');
    await next.cancel();
  });

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

  it('publishes OCR progress to session subscribers', async () => {
    const reader = subscribeSessionEvents('session-progress').getReader();
    await reader.read();

    publishSessionProgress('session-progress', 'run-1', '[ocr] reviewing sample.ts');

    const text = new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain('event: review-progress');
    expect(text).toContain('run-1');
    expect(text).toContain('reviewing sample.ts');

    await reader.cancel();
  });

  it('new subscribers receive the latest OCR progress snapshot', async () => {
    publishSessionProgress('session-progress-replay', 'run-2', '[ocr] reviewing TeachOS');
    const reader = subscribeSessionEvents('session-progress-replay').getReader();
    await reader.read();

    const text = new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain('event: review-progress');
    expect(text).toContain('reviewing TeachOS');

    await reader.cancel();
  });

  it('new queued runs do not replay the previous run progress', async () => {
    publishSessionProgress('session-progress-reset', 'run-old', '[ocr] old run');
    publishSessionStatus('session-progress-reset', 'queued');
    const reader = subscribeSessionEvents('session-progress-reset').getReader();
    await reader.read();

    const result = await Promise.race([
      reader.read().then((chunk) => new TextDecoder().decode(chunk.value)),
      new Promise<string>((resolve) => setTimeout(() => resolve('no-progress'), 20)),
    ]);
    expect(result).not.toContain('old run');

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
