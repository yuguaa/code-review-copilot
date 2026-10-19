import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { context, metrics, trace } from '@opentelemetry/api';

import { startTelemetry, stopTelemetry, withRunSpan, withSpan } from '../server/platform/telemetry/telemetry.service';

const binary = process.env.COLLECTOR_BINARY;
assert(binary, '必须通过 COLLECTOR_BINARY 指定真实 Collector 可执行文件');
const directory = resolve('.dev-postgres/telemetry-validation');
const marker = `validation-${Date.now()}`;
process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://127.0.0.1:14317';
process.env.OTEL_EXPORTER_OTLP_INSECURE = 'true';
process.env.OTEL_RESOURCE_ATTRIBUTES = `service.namespace=validation,review.run.id=${marker}`;

function waitUntil(check: () => Promise<boolean>, deadline: number): Promise<void> {
  return check().then((ready) => {
    if (ready) return;
    if (Date.now() >= deadline) throw new Error('遥测验证超过等待时间');
    return delay(100).then(() => waitUntil(check, deadline));
  });
}

function verify(): Promise<void> {
  return mkdir(directory, { recursive: true }).then(() => {
    const collector = spawn(binary!, ['--config=deploy/collector.yml', '--config=deploy/collector-validation.yml'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let logs = '';
    collector.stderr.on('data', (chunk: Buffer) => { logs = (logs + chunk.toString()).slice(-16_384); });
    return once(collector, 'spawn').then(() => waitUntil(() => {
      if (collector.exitCode !== null) throw new Error(`Collector 启动失败：${logs}`);
      return fetch('http://127.0.0.1:14333', { signal: AbortSignal.timeout(1000) }).then((response) => response.ok, () => false);
    }, Date.now() + 10_000)).then(() => startTelemetry()).then(() => withRunSpan(marker, (traceId, traceparent) => {
      const active = trace.getSpan(context.active())!.spanContext();
      assert.equal(traceId, active.traceId);
      assert.equal(traceparent, `00-${active.traceId}-${active.spanId}-${active.traceFlags.toString(16).padStart(2, '0')}`);
      metrics.getMeter('validation').createCounter('validation.high.cardinality')
        .add(1, { 'review.run.id': marker, status: 'completed' });
      return Promise.resolve();
    })).then(() => withSpan('connector.gitlab.publish', { 'review.run.id': marker }, () =>
      fetch('http://127.0.0.1:1', { signal: AbortSignal.timeout(1000) }).then(() => undefined),
    ).then(() => { throw new Error('预期测试端口拒绝连接'); }, () => undefined))
      .then(() => stopTelemetry()).then(() => waitUntil(() =>
      fetch('http://127.0.0.1:18889/metrics', { signal: AbortSignal.timeout(1000) })
        .then((response) => response.text()).then((text) => {
          assert(!text.includes(marker), '指标中不应存在运行标识');
          return text.includes('review_run_count_total') && text.includes('review_run_duration_seconds_bucket')
            && text.includes('review_operation_count_total') && text.includes('name="connector.publish"') && text.includes('status="failed"');
        }), Date.now() + 5_000),
    ).then(() => waitUntil(() => readFile(resolve(directory, 'traces.json'), 'utf8').then((content) => {
      for (const line of content.trim().split('\n').filter(Boolean)) JSON.parse(line);
      assert(!content.includes('"exception"'), 'Trace 不能包含完整错误对象');
      return content.includes(marker) && content.includes('review.run');
    }), Date.now() + 5_000)).then(() => {
      console.log('真实 Collector 验证通过：OTLP gRPC、W3C 上下文、trace 输出、运行指标和属性过滤。');
    }).finally(() => stopTelemetry().finally(() => {
      if (collector.exitCode !== null || collector.signalCode !== null) return;
      const exit = once(collector, 'exit');
      collector.kill('SIGTERM');
      const timeout = setTimeout(() => collector.kill('SIGKILL'), 5000);
      return exit.finally(() => clearTimeout(timeout));
    }));
  });
}

verify().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
