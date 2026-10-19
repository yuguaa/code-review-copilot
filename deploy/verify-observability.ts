import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

import { startTelemetry, stopTelemetry, withRunSpan, withSpan } from '../server/platform/telemetry/telemetry.service.ts';

const runId = `observability-validation-${Date.now()}`;
process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4317';
process.env.OTEL_EXPORTER_OTLP_INSECURE = 'true';
process.env.OTEL_RESOURCE_ATTRIBUTES = `service.namespace=validation,review.run.id=${runId}`;
const headers = { 'X-WEBAUTH-USER': 'observability-validation', 'X-WEBAUTH-ROLE': 'Admin' };

function waitUntil(check: () => Promise<boolean>, deadline: number): Promise<void> {
  return check().then((ready) => {
    if (ready) return;
    if (Date.now() >= deadline) throw new Error('观测服务验证超过等待时间');
    return delay(500).then(() => waitUntil(check, deadline));
  });
}

function verifyGrafana(): Promise<void> {
  const origin = 'http://grafana:3000/observability';
  return waitUntil(() => fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) })
    .then((response) => response.ok, () => false), Date.now() + 10_000)
    .then(() => fetch(`${origin}/api/user`)).then((response) => {
    assert.equal(response.status, 401, 'Grafana 必须拒绝匿名访问');
    return fetch(`${origin}/api/user`, { headers });
  }).then((response) => {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie'), null, '代理认证不能建立 Grafana 独立 Cookie');
    return response.json();
  }).then((user) => {
    assert.equal(user.login, 'observability-validation');
    return fetch(`${origin}/api/datasources`, { headers }).then((response) => response.json());
  }).then((datasources) => {
    assert(Array.isArray(datasources));
    assert(datasources.some((source: { uid: string }) => source.uid === 'tempo'));
    assert(datasources.some((source: { uid: string }) => source.uid === 'prometheus'));
    return fetch(`${origin}/api/dashboards/uid/review-platform`, { headers });
  }).then((response) => {
    assert.equal(response.status, 200, '预置仪表盘必须可读');
    return fetch(`${origin}/api/access-control/user/permissions`, { headers }).then((permissionResponse) => permissionResponse.json());
  }).then((permissions) => {
    assert(permissions['datasources:explore'], '项目账号必须能够在 Explore 中查看 trace');
    return fetch(`${origin}/api/user`, { headers: { Cookie: 'grafana_session=copied' } });
  }).then((response) => {
    assert.equal(response.status, 401, 'Grafana Cookie 不能独立完成认证');
    return fetch(`${origin}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'observability-validation', password: 'validation' }) });
  }).then((response) => {
    assert(response.status >= 400 && response.status < 500, 'Grafana 密码登录必须被禁用');
  });
}

function verifyTelemetry(): Promise<void> {
  let traceId = '';
  return startTelemetry().then(() => withRunSpan(runId, (id, traceparent) => {
    assert.match(id, /^[a-f0-9]{32}$/);
    assert(traceparent.includes(id));
    traceId = id;
    return withSpan('workspace.prepare', { 'review.run.id': runId }, () => Promise.resolve());
  })).then(() => stopTelemetry()).then(() => waitUntil(() =>
    fetch(`http://tempo:3200/api/traces/${traceId}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(2000) })
      .then((response) => response.status === 200 ? response.json() : null)
      .then((body) => body !== null && JSON.stringify(body).includes(runId)),
  Date.now() + 20_000)).then(() => waitUntil(() =>
    fetch('http://prometheus:9090/api/v1/query?query=review_run_count_total', { signal: AbortSignal.timeout(2000) })
      .then((response) => response.json()).then((body) => {
        assert.equal(body.status, 'success');
        assert(!JSON.stringify(body).includes(runId), 'Prometheus 不应保存运行标识标签');
        return body.data.result.some((series: { value: [number, string] }) => Number(series.value[1]) > 0);
      }),
  Date.now() + 25_000));
}

verifyGrafana().then(() => verifyTelemetry()).then(() => {
  console.log('Grafana 匿名拒绝、代理认证、独立 Cookie 禁用、数据源和仪表盘验证通过。');
  console.log('平台 SDK → Collector → Tempo trace、Prometheus metrics 链路验证通过。');
}).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => stopTelemetry());
