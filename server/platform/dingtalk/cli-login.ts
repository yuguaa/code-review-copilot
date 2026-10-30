import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';

import { executeProcess } from '@server/infrastructure/process/process.service';

import type { DingtalkLoginState } from '@shared/dingtalk';

export function readLoginLine(line: string): { authorizationUrl?: string; userCode?: string } {
  const text = line.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '').trim();
  if (text.startsWith('https://')) {
    const url = new URL(text);
    if (!url.username && !url.password && (url.hostname === 'dingtalk.com' || url.hostname.endsWith('.dingtalk.com'))) return { authorizationUrl: url.href };
  }
  const code = /^授权码[:：]\s*([A-Za-z0-9-]+)$/.exec(text);
  return code ? { userCode: code[1] } : {};
}

/** 原生设备登录在后台等待扫码；仅提取授权链接，不向网页透传终端或凭据。 */
export function createDwsLoginManager(execute = executeProcess) {
  let current: DingtalkLoginState | null = null;
  let controller: AbortController | undefined;
  let pending: Promise<void> = Promise.resolve();
  let settling = false;
  return {
    state: () => current,
    start: () => {
      if (settling && current) return current;
      const login: DingtalkLoginState = { id: randomUUID(), status: 'pending', authorizationUrl: null, userCode: null,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), error: null };
      current = login;
      settling = true;
      controller = new AbortController();
      const decoder = new StringDecoder('utf8');
      let buffer = '';
      const consume = (chunk: Buffer) => {
        buffer += decoder.write(chunk);
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const parsed = readLoginLine(line);
          if (parsed.authorizationUrl) {
            const next = new URL(parsed.authorizationUrl);
            const previous = login.authorizationUrl ? new URL(login.authorizationUrl) : null;
            if (!previous || next.search || `${next.origin}${next.pathname}` !== `${previous.origin}${previous.pathname}`) login.authorizationUrl = next.href;
          }
          if (parsed.userCode) login.userCode = parsed.userCode;
        }
      };
      pending = execute(process.env.DWS_BIN || 'dws', ['auth', 'login', '--device', '--no-browser', '--recommend', '--yes', '--format=json'], {
        signal: controller.signal, timeoutMs: 10 * 60_000, maxBytes: 2 * 1024 * 1024, onStderr: consume,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8', DWS_LANG: 'zh',
          DWS_CONFIG_DIR: process.env.DWS_CONFIG_DIR, DWS_NO_UPDATE_CHECK: '1' },
      }).then((result) => {
        if (login.status === 'cancelled') return;
        if (result.error || result.code !== 0) throw new Error('钉钉 CLI 授权未完成，请重新扫码并检查企业权限');
        const output = JSON.parse(result.stdout);
        if (output.success !== true || output.token_valid !== true || !output.corp_id || !output.user_id) throw new Error('钉钉 CLI 未返回有效的登录身份');
        login.status = 'completed';
      }).catch(() => {
        if (login.status === 'cancelled') return;
        login.status = 'failed';
        login.error = '钉钉 CLI 授权未完成或已过期，请重新扫码并检查企业是否开放 CLI 数据权限。';
      }).finally(() => { settling = false; });
      return login;
    },
    cancel: (id: string) => {
      if (!current || current.id !== id || current.status !== 'pending') throw new Error('登录会话已变化或已结束');
      current.status = 'cancelled'; controller?.abort(new Error('登录已取消'));
      return pending.then(() => current);
    },
    stop: () => { controller?.abort(new Error('Worker 正在关闭')); return pending; },
  };
}
