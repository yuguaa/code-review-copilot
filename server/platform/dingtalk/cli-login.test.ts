import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { executeProcess } from '@server/infrastructure/process/process.service';
import { createDwsLoginManager, readLoginLine } from './cli-login';

describe('DWS 原生设备登录生命周期', () => {
  it('只展示钉钉 HTTPS 授权地址和设备码，不透传凭据或其他网址', () => {
    expect(readLoginLine('https://login.dingtalk.com/oauth/device?user_code=ABCD')).toEqual({ authorizationUrl: 'https://login.dingtalk.com/oauth/device?user_code=ABCD' });
    const code = 'LOCAL-CODE';
    expect(readLoginLine(`\u001b[33m授权码: ${code}\u001b[0m`)).toEqual({ userCode: code });
    for (const line of ['https://dingtalk.com.evil.invalid/login', 'https://user:secret@login.dingtalk.com/', '{"access_token":"secret"}', 'http://login.dingtalk.com/']) expect(readLoginLine(line)).toEqual({});
  });

  it('真实子进程等待授权期间可读取二维码地址，重复开始只运行一次', async () => {
    const directory = path.resolve('temp', `dws-login-${randomUUID()}`);
    const fixture = path.join(directory, 'device-login.cjs');
    await mkdir(directory, { recursive: true });
    await writeFile(fixture, `console.error('授权码: TEST-CODE'); console.error('https://login.dingtalk.com/oauth/device?user_code=TEST-CODE'); setTimeout(()=>console.log(JSON.stringify({success:true,token_valid:true,corp_id:'corp',user_id:'user'})),200);`);
    let count = 0;
    const manager = createDwsLoginManager((_command, args, options) => {
      count += 1;
      expect(args).toEqual(['auth', 'login', '--device', '--no-browser', '--recommend', '--yes', '--format=json']);
      return executeProcess(process.execPath, [fixture], options);
    });
    try {
      const first = manager.start();
      expect(manager.start().id).toBe(first.id);
      expect(first.status).toBe('pending');
      await vi.waitFor(() => expect(manager.state()?.authorizationUrl).toContain('user_code=TEST-CODE'));
      expect(manager.state()?.userCode).toBe('TEST-CODE');
      await vi.waitFor(() => expect(manager.state()?.status).toBe('completed'));
      expect(count).toBe(1);
      expect(JSON.stringify(manager.state())).not.toContain('token_valid');
    } finally { await manager.stop(); }
  });

  it('取消会终止并回收原生登录进程，不允许旧登录覆盖新状态', async () => {
    const directory = path.resolve('temp', `dws-cancel-${randomUUID()}`);
    const fixture = path.join(directory, 'device-login.cjs');
    await mkdir(directory, { recursive: true });
    await writeFile(fixture, 'setInterval(()=>{},1000);');
    const manager = createDwsLoginManager((_command, _args, options) => executeProcess(process.execPath, [fixture], options));
    const login = manager.start();
    await manager.cancel(login.id);
    expect(manager.state()?.status).toBe('cancelled');
    expect(() => manager.cancel(login.id)).toThrow();
    await manager.stop();
  });
});
