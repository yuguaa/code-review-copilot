import { describe, expect, it } from 'vitest';

import { buildDwsCommand, parseDwsResult } from './cli-runtime';
import { createDingtalkWorker } from './cli-worker';

import type { DingtalkCliRequest } from '@shared/dingtalk';

const request: Extract<DingtalkCliRequest, { action: 'send' }> = { action: 'send', profile: 'corp:user',
  robotCode: 'bot-1', groupId: 'cid-test', userIds: ['actual-dingtalk-user'], title: 'Review', text: '@./secret $(whoami)\n报告正文' };

describe('DWS 调用边界', () => {
  it('个人私聊使用 CLI 登录身份、单个 userId、固定幂等键和投递回执，正文按纯文本处理', () => {
    const input = { action: 'send-user' as const, profile: 'corp:user', userId: 'actual-dingtalk-user', idempotencyKey: 'review-fixed-key', title: 'Review', text: '![不得上传](./credentials) @literal' };
    const command = buildDwsCommand(input);
    expect(command.args).toEqual(expect.arrayContaining(['--as=user', '--user=actual-dingtalk-user', '--idempotency-key=review-fixed-key', '--wait-delivery', '--text=-', '--body-stdin', '--yes']));
    expect(command.args.some((arg) => arg.startsWith('--robot-code') || arg.startsWith('--group') || arg.startsWith('--users') || arg.startsWith('--markdown'))).toBe(false);
    expect(command.stdin).toBe(`${input.title}\n\n${input.text}`);
    expect(() => parseDwsResult(input, { openMessageId: 'message', deliveryStatus: 'unknown', idempotencyKey: input.idempotencyKey })).toThrow();
    expect(() => parseDwsResult(input, { openMessageId: 'message', deliveryStatus: 'delivered', idempotencyKey: 'wrong-key' })).toThrow();
    expect(parseDwsResult(input, { openMessageId: 'message', deliveryStatus: 'delivered', idempotencyKey: input.idempotencyKey })).toEqual({ status: 'accepted', remoteIds: ['message'] });
  });

  it('登录身份从原生 CLI 元数据解析，不接受 Token 作为身份', () => {
    expect(buildDwsCommand({ action: 'auth-status' }).args).not.toContain('--profile=');
    const result = parseDwsResult({ action: 'auth-status' }, { authenticated: true, token_valid: true, corp_id: 'corp', user_id: 'user', access_token: 'not-a-real-credential' });
    expect(result).toMatchObject({ profile: 'corp:user', authenticated: true });
    expect(JSON.stringify(result)).not.toContain('not-a-real-credential');
  });

  it('Worker 在登录身份不匹配时拒绝个人发送', async () => {
    let sends = 0;
    const token = 'x'.repeat(32);
    const app = createDingtalkWorker(token, (input) => {
      if (input.action === 'auth-status') return Promise.resolve({ authenticated: true, tokenValid: true, profile: 'other:user', userName: '其他用户', corpName: '其他组织', reason: null });
      sends += 1; return Promise.resolve({ status: 'accepted' as const, remoteIds: ['should-not-send'] });
    });
    const response = await app.request('/execute', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'send-user', profile: 'corp:user', userId: 'recipient', idempotencyKey: 'fixed-key', title: 'Review', text: '正文' }) });
    expect(response.status).toBe(502);
    expect(sends).toBe(0);
  });

  it('群消息使用明确的 Profile、机器人身份和 @ ID，正文只经 stdin 传递', () => {
    const command = buildDwsCommand(request);
    expect(command.args).toContain('--profile=corp:user');
    expect(command.args).toContain('--as=bot');
    expect(command.args).toContain('--at-user-ids=actual-dingtalk-user');
    expect(command.args).toContain('--body-stdin');
    expect(command.args.join(' ')).not.toContain('secret');
    expect(command.stdin).toBe(`@actual-dingtalk-user\n\n${request.text}`);
  });

  it('私聊不包含群 ID 和群 @ 参数', () => {
    const args = buildDwsCommand({ ...request, groupId: undefined }).args;
    expect(args).toContain('--users=actual-dingtalk-user');
    expect(args.some((arg) => arg.startsWith('--group=') || arg.startsWith('--at-'))).toBe(false);
  });

  it('退出码成功不等于发送成功，拒绝 dry-run 和业务失败', () => {
    for (const response of [{}, { success: true }, { dry_run: true, executed: false },
      { ok: true, identity: 'bot', tool: 'send_robot_group_message', result: { success: false } }]) {
      expect(() => parseDwsResult(request, response)).toThrow();
    }
    expect(parseDwsResult(request, { ok: true, identity: 'bot', tool: 'send_robot_group_message',
      result: { success: true, processQueryKey: 'receipt-1' } })).toEqual({ status: 'accepted', remoteIds: ['receipt-1'] });
  });

  it('授权状态只返回明确字段，不泄露 Token', () => {
    const status = parseDwsResult({ action: 'status', profile: 'corp:user' }, { authenticated: true, token_valid: true,
      user_name: '测试用户', access_token: 'must-not-leak', refresh_token: 'must-not-leak' });
    expect(status).toMatchObject({ authenticated: true, tokenValid: true, userName: '测试用户' });
    expect(JSON.stringify(status)).not.toContain('must-not-leak');
  });

  it('Worker 拒绝未授权、任意命令和无收件人发送', async () => {
    let invoked = false;
    const token = 'x'.repeat(32);
    const app = createDingtalkWorker(token, () => { invoked = true; return Promise.resolve({ status: 'accepted', remoteIds: [] }); });
    expect((await app.request('/execute', { method: 'POST', body: JSON.stringify(request) })).status).toBe(401);
    for (const body of [{ action: 'exec', command: 'sh' }, { ...request, cliPath: '/bin/sh' }, { ...request, groupId: undefined, userIds: [] }]) {
      expect((await app.request('/execute', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(400);
    }
    expect(invoked).toBe(false);
  });
});
