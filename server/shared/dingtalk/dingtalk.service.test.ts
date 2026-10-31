import { createServer } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { dingtalkDestinationFingerprint, sendDingtalk } from './dingtalk.service';

const received: unknown[] = [];
let webhook: string;
const server = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => {
    received.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(request.url === '/failed' ? { errcode: 310000 } : { errcode: 0 }));
  });
});
beforeAll(() => new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('测试服务端口无效');
  webhook = `http://127.0.0.1:${address.port}`;
  resolve();
})));
afterAll(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

describe('Webhook 兼容发送', () => {
  it('保留原通知，并为指定 ID 添加正文占位与 at 字段', async () => {
    await sendDingtalk({ webhook }, '标题', '正文');
    expect(received[0]).toEqual({ msgtype: 'markdown', markdown: { title: '标题', text: '正文' } });
    await sendDingtalk({ webhook }, '标题', '正文', { userIds: ['ding-user'] });
    expect(received[1]).toMatchObject({ markdown: { text: '@ding-user\n\n正文' }, at: { atUserIds: ['ding-user'], isAtAll: false } });
  });

  it('HTTP 200 下的机器人业务错误仍然拒绝，Webhook 不模拟私聊', async () => {
    await expect(sendDingtalk({ webhook: `${webhook}/failed` }, '标题', '正文')).rejects.toThrow('钉钉发送失败：310000');
    await expect(sendDingtalk({ webhook }, '标题', '正文', { userIds: ['ding-user'], direct: true })).rejects.toThrow('不支持私聊');
  });

  it('同一机器人修改目标或 Secret 时指纹变化，不暴露配置原文', () => {
    const current = dingtalkDestinationFingerprint({ webhook, secret: 'old-secret' });
    expect(current).toMatch(/^[a-f0-9]{64}$/);
    expect(current).not.toBe(dingtalkDestinationFingerprint({ webhook: `${webhook}/other-group`, secret: 'old-secret' }));
    expect(current).not.toBe(dingtalkDestinationFingerprint({ webhook, secret: 'new-secret' }));
    expect(dingtalkDestinationFingerprint({ webhook })).toBe(dingtalkDestinationFingerprint({ webhook, secret: null }));
  });
});
