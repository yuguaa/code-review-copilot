import { metrics, propagation, context, SpanStatusCode, trace } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { createAllowListAttributesProcessor, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';

let sdk: NodeSDK | undefined;

export function startTelemetry(): Promise<void> {
  return Promise.resolve().then(() => {
    if (sdk || !process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || process.env.OTEL_SDK_DISABLED === 'true') return;
    const current = new NodeSDK({
      serviceName: 'code-review-copilot',
      traceExporter: new OTLPTraceExporter(),
      metricReaders: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter(), exportIntervalMillis: 15_000 })],
      views: [
        { instrumentName: 'review.run.*', attributesProcessors: [createAllowListAttributesProcessor(['status'])] },
        { instrumentName: 'review.operation.*', attributesProcessors: [createAllowListAttributesProcessor(['name', 'status'])] },
      ],
      logRecordProcessors: [],
    });
    current.start();
    sdk = current;
  });
}

export function stopTelemetry(): Promise<void> {
  if (!sdk) return Promise.resolve();
  const current = sdk;
  sdk = undefined;
  return current.shutdown();
}

export function withRunSpan<T>(runId: string, fn: (traceId: string, traceparent: string) => Promise<T>): Promise<T> {
  return withSpan('review.run', { 'review.run.id': runId }, () => {
    if (!sdk) return fn('', '');
    const active = trace.getSpan(context.active())!.spanContext();
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    return fn(active.traceId, carrier.traceparent);
  });
}

export function withSpan<T>(name: string, attributes: Record<string, string | number>, fn: () => Promise<T>): Promise<T> {
  if (!sdk) return Promise.resolve().then(fn);
  return trace.getTracer('code-review-copilot').startActiveSpan(name, { attributes }, (span) => {
    const meter = metrics.getMeter('code-review-copilot');
    const started = performance.now();
    let status = 'completed';
    return Promise.resolve().then(fn)
      .then((result) => {
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      }, (error: unknown) => {
        status = 'failed';
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      })
      .finally(() => {
        const operation = ['review.run', 'workspace.prepare', 'engine.process', 'engine.result.persist'].includes(name)
          ? name : name.startsWith('connector.') ? 'connector.publish' : 'other';
        meter.createCounter('review.operation.count', { description: '执行阶段数量' }).add(1, { name: operation, status });
        meter.createHistogram('review.operation.duration', { unit: 's', description: '执行阶段耗时' })
          .record((performance.now() - started) / 1000, { name: operation, status });
        if (name === 'review.run') {
          meter.createCounter('review.run.count', { description: '审查运行数量' }).add(1, { status });
          meter.createHistogram('review.run.duration', { unit: 's', description: '审查执行时间' })
            .record((performance.now() - started) / 1000, { status });
        }
        span.end();
      });
  });
}
