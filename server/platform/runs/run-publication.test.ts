import { AxiosError } from 'axios';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';

import { classifyDeliveryError } from './run-publication';

describe('发送结果判定', () => {
  it('没有尝试发送时，配置与查询错误为 failed', () => {
    expect(classifyDeliveryError(new Error('查询失败'), false).status).toBe('failed');
  });

  it('尝试发送后的超时或断开连接为 unknown', () => {
    expect(classifyDeliveryError(new AxiosError('请求超时', 'ETIMEDOUT'), true).status).toBe('unknown');
    expect(classifyDeliveryError(new AxiosError('连接断开', 'ECONNRESET'), true).status).toBe('unknown');
  });

  it('远端已经明确拒绝发送时为 failed', () => {
    expect(classifyDeliveryError(new HTTPException(409, { message: 'MR 已更新' }), true)).toEqual({ status: 'failed', error: 'MR 已更新' });
    expect(classifyDeliveryError(new Error('钉钉发送失败：310000'), true).status).toBe('failed');
  });

  it('之前尚未确认的发送结果持续保留 unknown', () => {
    expect(classifyDeliveryError(new Error('查询失败'), false, true).status).toBe('unknown');
    expect(classifyDeliveryError(new HTTPException(409), true, true).status).toBe('unknown');
  });

  it('持久化的错误说明不包含原始网络凭证', () => {
    expect(classifyDeliveryError(new AxiosError('https://example.invalid?access_token=credential'), true).error).not.toContain('credential');
  });
});
