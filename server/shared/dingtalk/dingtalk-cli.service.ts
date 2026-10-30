import { HTTPException } from 'hono/http-exception';

import type { DingtalkCliRequest } from '@shared/dingtalk';

export function callDingtalkCli(request: DingtalkCliRequest, signal?: AbortSignal): Promise<unknown> {
  const token = process.env.DINGTALK_WORKER_TOKEN;
  const url = process.env.DINGTALK_WORKER_URL;
  const sending = request.action === 'send' || request.action === 'send-user';
  if (!token || !url) return Promise.reject(new HTTPException(503, { message: '尚未配置钉钉 CLI Worker，请先启用 dingtalk 部署配置' }));
  return fetch(new URL('/execute', url), { method: 'POST', redirect: 'error',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(request), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(55_000)]) : AbortSignal.timeout(55_000),
  }).then((response) => response.json().then((body) => {
    if (!response.ok) {
      const reason = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' && /^DWS 调用失败：[a-z_]+$/.test(body.error) ? `（${body.error}）` : '';
      throw new HTTPException(502, { message: `钉钉 CLI 调用失败，请检查 Worker、扫码授权与企业数据权限${reason}` });
    }
    return body;
  }), () => { signal?.throwIfAborted(); throw new HTTPException(502, { message: sending ? '无法连接钉钉 CLI Worker；发送结果可能未知，请勿自动重发' : '无法连接钉钉 CLI Worker，请检查 dingtalk 服务是否启动' }); });
}
