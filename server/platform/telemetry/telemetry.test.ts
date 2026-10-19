import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startTelemetry, stopTelemetry, withRunSpan } from './telemetry.service';

const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const originalDisabled = process.env.OTEL_SDK_DISABLED;

beforeEach(() => {
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  delete process.env.OTEL_SDK_DISABLED;
});

afterEach(() => stopTelemetry().then(() => {
  if (originalEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint;
  if (originalDisabled === undefined) delete process.env.OTEL_SDK_DISABLED;
  else process.env.OTEL_SDK_DISABLED = originalDisabled;
}));

describe('未启用遥测时继续执行审查业务', () => {
  it('缺少 Collector 地址时返回空追踪标识和业务结果', () => startTelemetry().then(() =>
    withRunSpan('run-without-telemetry', (traceId, traceparent) => {
      expect(traceId).toBe('');
      expect(traceparent).toBe('');
      return Promise.resolve(42);
    }),
  ).then((result) => expect(result).toBe(42)));

  it('保留业务执行错误', () => {
    const error = new Error('审查进程执行失败');
    return expect(withRunSpan('failed-run', () => Promise.reject(error))).rejects.toBe(error);
  });

  it('明确关闭 SDK 时不建立追踪', () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://127.0.0.1:4317';
    process.env.OTEL_SDK_DISABLED = 'true';
    return startTelemetry().then(() => withRunSpan('disabled-run', (traceId, traceparent) => {
      expect([traceId, traceparent]).toEqual(['', '']);
      return Promise.resolve('completed');
    })).then((result) => expect(result).toBe('completed'));
  });
});
