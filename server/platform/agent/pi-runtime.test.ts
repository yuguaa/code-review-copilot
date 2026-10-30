import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPiModel, createPiRuntime } from './pi-runtime';

const modelConfig = { provider: 'openai-compatible', modelId: 'local-test', apiKey: 'local-test-key',
  apiBaseUrl: 'http://127.0.0.1:1/v1', maxSteps: 2 };
const options = { modelConfig, systemPrompt: 'Test runtime lifecycle.', tools: [], timeoutMs: 5000 };

afterEach(() => vi.restoreAllMocks());

describe('Pi Runtime Promise 与清理契约', () => {
  it.each([{ timeoutMs: 0 }, { maxSteps: 0 }])('无效参数以 rejected Promise 返回：%j', (invalid) => {
    let result: ReturnType<typeof createPiRuntime> | undefined;
    expect(() => { result = createPiRuntime({ ...options, ...invalid }); }).not.toThrow();
    return expect(result).rejects.toThrow('Agent');
  });

  it('模型参数错误同样以 rejected Promise 返回', () => {
    let result: ReturnType<typeof createPiModel> | undefined;
    expect(() => { result = createPiModel({ ...modelConfig, apiKey: '' }); }).not.toThrow();
    return expect(result).rejects.toThrow('模型缺少');
  });

  it.each([
    ['anthropic', 'anthropic-messages', 'https://api.anthropic.com'],
    ['openai', 'openai-responses', 'https://api.openai.com/v1'],
    ['openai-compatible', 'openai-completions', modelConfig.apiBaseUrl],
  ])('保留 %s 的协议和默认地址', (provider, api, baseUrl) => createPiModel({ ...modelConfig, provider,
    apiBaseUrl: provider === 'openai-compatible' ? modelConfig.apiBaseUrl : null }).then(({ model }) => {
    expect(model.api).toBe(api);
    expect(model.baseUrl).toBe(baseUrl);
  }));

  it('重复 dispose 等待同一次清理，abort 失败也一定释放会话', () => createPiRuntime(options).then((runtime) => {
    const failure = new Error('abort failed');
    let rejectAbort!: (error: Error) => void;
    const abort = vi.spyOn(runtime.session, 'abort').mockImplementation(() => new Promise<void>((_resolve, reject) => { rejectAbort = reject; }));
    const dispose = vi.spyOn(runtime.session, 'dispose');
    const first = runtime.dispose();
    const repeated = runtime.dispose();
    expect(repeated).toBe(first);
    return Promise.resolve().then(() => rejectAbort(failure)).then(() => expect(first).rejects.toBe(failure)).then(() => {
      expect(abort).toHaveBeenCalledTimes(1);
      expect(dispose).toHaveBeenCalledTimes(1);
    });
  }));

  it('取消与释放同时失败时保留 abort 根因和全部清理错误', () => createPiRuntime(options).then((runtime) => {
    const first = new Error('original abort failure');
    const second = new Error('dispose failure');
    vi.spyOn(runtime.session, 'abort').mockRejectedValue(first);
    const release = runtime.session.dispose.bind(runtime.session);
    const dispose = vi.spyOn(runtime.session, 'dispose').mockImplementation(() => { release(); throw second; });
    return runtime.dispose().then(() => { throw new Error('清理应报告失败'); }, (error: unknown) => {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([first, second]);
      expect((error as Error).cause).toBe(first);
      expect(dispose).toHaveBeenCalledTimes(1);
    });
  }));
});
