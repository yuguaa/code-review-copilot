import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildDwsCommand, parseDwsResult, runDws } from './cli-runtime';
import { createDingtalkWorker } from './cli-worker';
import { createDwsLoginManager } from './cli-login';

import type { DingtalkCliRequest } from '@shared/dingtalk';

const request: Extract<DingtalkCliRequest, { action: 'send' }> = { action: 'send', profile: 'corp:user',
  robotCode: 'bot-1', groupId: 'cid-test', userIds: ['actual-dingtalk-user'], title: 'Review', text: '@./secret $(whoami)\n报告正文' };
const identityRequests: DingtalkCliRequest[] = [
  { action: 'status', profile: 'corp:user' },
  { action: 'search', profile: 'corp:user', query: '251111', dimension: 'jobNumber' },
  { action: 'person', profile: 'corp:user', userId: 'real-user' },
];

describe('DWS 调用边界', () => {
  it('实际子进程同时使用持久化配置目录和加密钥匙串目录', async () => {
    const directory = path.resolve('temp', `dws-keychain-${randomUUID()}`);
    const binary = path.join(directory, 'dws-fixture.cjs');
    const keychain = path.join(directory, 'keychain');
    await mkdir(directory, { recursive: true });
    await writeFile(binary, `#!/usr/bin/env node\nif(process.env.DWS_KEYCHAIN_DIR!==${JSON.stringify(keychain)})process.exit(7);console.log(JSON.stringify({authenticated:true,token_valid:true,corp_id:'corp',user_id:'user'}));\n`, { mode: 0o700 });
    const previous = { binary: process.env.DWS_BIN, keychain: process.env.DWS_KEYCHAIN_DIR };
    process.env.DWS_BIN = binary; process.env.DWS_KEYCHAIN_DIR = keychain;
    try { expect(await runDws({ action: 'auth-status' })).toMatchObject({ authenticated: true, tokenValid: true, profile: 'corp:user' }); }
    finally {
      if (previous.binary === undefined) delete process.env.DWS_BIN; else process.env.DWS_BIN = previous.binary;
      if (previous.keychain === undefined) delete process.env.DWS_KEYCHAIN_DIR; else process.env.DWS_KEYCHAIN_DIR = previous.keychain;
    }
  });

  it('个人私聊命令和回执解析已停用，不能绕过群通知流程', () => {
    const input = { action: 'send-user' as const, profile: 'corp:user', userId: 'actual-dingtalk-user', idempotencyKey: 'review-fixed-key', title: 'Review', text: '![不得上传](./credentials) @literal' };
    expect(() => buildDwsCommand(input)).toThrow('私聊已停用');
    expect(() => parseDwsResult(input, { openMessageId: 'message', deliveryStatus: 'unknown', idempotencyKey: input.idempotencyKey })).toThrow();
    expect(() => parseDwsResult(input, { openMessageId: 'message', deliveryStatus: 'delivered', idempotencyKey: 'wrong-key' })).toThrow();
    expect(() => parseDwsResult(input, { openMessageId: 'message', deliveryStatus: 'delivered', idempotencyKey: input.idempotencyKey })).toThrow('私聊已停用');
  });

  it('按候选 userId 读取人员详情核对工号，过滤电话邮箱等无关字段', () => {
    const input = { action: 'person' as const, profile: 'corp:user', userId: 'real-user' };
    expect(buildDwsCommand(input).args).toEqual(expect.arrayContaining(['contact', 'user', 'get', '--ids=real-user', '--profile=corp:user']));
    const body = { success: true, result: [{ orgEmployeeModel: { orgUserId: 'real-user', orgUserName: '提交人', jobNumber: '251111', orgAuthEmail: 'not-returned@example.invalid' } }] };
    expect(parseDwsResult(input, body)).toEqual({ userId: 'real-user', name: '提交人', employeeNo: '251111' });
    expect(() => parseDwsResult({ ...input, userId: 'different-user' }, body)).toThrow('不一致');
  });

  it('登录身份从原生 CLI 元数据解析，不接受 Token 作为身份', () => {
    expect(buildDwsCommand({ action: 'auth-status' }).args).not.toContain('--profile=');
    const result = parseDwsResult({ action: 'auth-status' }, { authenticated: true, token_valid: true, corp_id: 'corp', user_id: 'user', access_token: 'not-a-real-credential' });
    expect(result).toMatchObject({ profile: 'corp:user', authenticated: true });
    expect(JSON.stringify(result)).not.toContain('not-a-real-credential');
  });

  it('Worker 一律拒绝个人发送，不执行 CLI', async () => {
    let sends = 0;
    const token = 'x'.repeat(32);
    const app = createDingtalkWorker(token, (input) => {
      if (input.action === 'auth-status') return Promise.resolve({ authenticated: true, tokenValid: true, profile: 'other:user', userName: '其他用户', corpName: '其他组织', reason: null });
      sends += 1; return Promise.resolve({ status: 'accepted' as const, remoteIds: ['should-not-send'] });
    });
    const response = await app.request('/execute', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'send-user', profile: 'corp:user', userId: 'recipient', idempotencyKey: 'fixed-key', title: 'Review', text: '正文' }) });
    expect(response.status).toBe(410);
    expect(sends).toBe(0);
  });

  it.each([...identityRequests, request])('扫码期间拒绝 $action，不执行旧身份命令', async (input) => {
    let completeLogin!: () => void;
    const login = createDwsLoginManager(() => new Promise((resolve) => { completeLogin = () => resolve({ code: 0, signal: null, stderr: '',
      stdout: JSON.stringify({ success: true, token_valid: true, corp_id: 'new-corp', user_id: 'new-user' }) }); }));
    let executions = 0;
    const token = 'x'.repeat(32);
    const app = createDingtalkWorker(token, () => { executions += 1; return Promise.resolve({ userId: 'old-user', name: '旧身份人员' }); }, login);
    login.start();
    try {
      const response = await app.request('/execute', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(input) });
      expect(response.status).toBe(409);
      expect(executions).toBe(0);
    } finally { completeLogin(); await login.stop(); }
  });

  it.each([...identityRequests, request])('切换登录后 $action 的查询结果失效，已发送回执仍保留', async (input) => {
    let completeLogin!: () => void;
    const login = createDwsLoginManager(() => new Promise((resolve) => { completeLogin = () => resolve({ code: 0, signal: null, stderr: '',
      stdout: JSON.stringify({ success: true, token_valid: true, corp_id: 'new-corp', user_id: 'new-user' }) }); }));
    let queryStarted!: () => void;
    const started = new Promise<void>((resolve) => { queryStarted = resolve; });
    const result = input.action === 'send' ? { status: 'accepted' as const, remoteIds: ['actual-receipt'] }
      : { userId: 'old-user', name: '旧身份人员', employeeNo: '251111' };
    let completeQuery!: (value: typeof result) => void;
    let defer = false;
    const token = 'x'.repeat(32);
    const app = createDingtalkWorker(token, (operation) => {
      if (operation.action === 'auth-status') return Promise.resolve({ authenticated: true, tokenValid: true, profile: 'corp:user', userName: '授权人', corpName: '测试组织', reason: null });
      if (defer) return new Promise<typeof result>((resolve) => { completeQuery = resolve; queryStarted(); });
      return Promise.resolve(result);
    }, login);
    const send = () => app.request('/execute', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(input) });
    const stable = await send();
    expect(stable.status).toBe(200);
    expect(await stable.json()).toEqual(result);
    defer = true;
    const pending = send();
    await started;
    login.start();
    try {
      completeLogin(); await login.stop();
      expect(login.state()?.status).toBe('completed');
      completeQuery(result);
      const stale = await pending;
      expect(stale.status).toBe(input.action === 'send' ? 200 : 409);
      if (input.action === 'send') expect(await stale.json()).toEqual(result);
      else expect(await stale.text()).not.toContain('old-user');
    } finally { completeLogin(); completeQuery(result); await login.stop(); }
  });

  it.each([...identityRequests, request])('旧 Profile 的 $action 延迟到新身份登录后到达时，不执行 CLI', async (input) => {
    const token = 'x'.repeat(32);
    let activeProfile = 'corp:user';
    let executions = 0;
    const app = createDingtalkWorker(token, (operation) => {
      if (operation.action === 'auth-status') return Promise.resolve({ authenticated: true, tokenValid: true,
        profile: activeProfile, userName: '授权人', corpName: '组织', reason: null });
      executions += 1;
      return Promise.resolve({ userId: 'old-user', name: '旧组织人员' });
    });
    const send = () => app.request('/execute', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(input) });
    expect((await send()).status).toBe(200);
    expect(executions).toBe(1);
    activeProfile = 'new-corp:new-user';
    const stale = await send();
    expect(stale.status).toBe(409);
    expect(await stale.text()).not.toContain('old-user');
    expect(executions).toBe(1);
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

  it('机器人发送缺少群 ID 时拒绝，不能变成机器人私聊', () => {
    expect(() => buildDwsCommand({ ...request, groupId: undefined })).toThrow('不支持私聊');
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
