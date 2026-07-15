import type { UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { isReviewActivityState } from '../../../shared/review-activity';
import {
  appendReviewAgentTraceStep,
  completeReviewAgentTrace,
  createReviewAgentTrace,
  createReviewActivityState,
  failReviewAgentTrace,
  failRunningReviewAgents,
  sanitizeReviewAgentResult,
  updateReviewAgentActivity,
  upsertReviewActivityMessage,
  type ReviewAgentTraceStepSource,
} from './review-activity';

const primary = {
  id: 'primary',
  label: '主审查 Agent',
  provider: 'openai',
  modelId: 'gpt-5',
  task: '分析变更并取证',
  status: 'running' as const,
};

const credentialSamples = [
  'plain-api-credential',
  'plain-client-secret',
  'dXNlcjpwYXNzd29yZA==',
  'AKIAABCDEFGHIJKLMNOP',
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123',
  'npm_abcdefghijklmnopqrstuvwxyz',
  ['xoxb', '1234567890', 'abcdefghijklmnopqrstuvwxyz'].join('-'),
  'AIzaabcdefghijklmnopqrstuvwxyz123456',
  'db-password',
  'redis-pass',
  'opaquecredential123456',
  'opaque-token-value-12345',
  'opaque-service-value',
  'QWxhZGRpbjpPcGVuU2VzYW1l',
  'azure-connection-secret',
  'arbitrary-value-12345',
  ['sk', 'live', '51ABCDEFGHIJKLMNOPQRSTUVWXYZ123456'].join('_'),
  ['rk', 'test', '51ABCDEFGHIJKLMNOPQRSTUVWXYZ123456'].join('_'),
  ['whsec', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456'].join('_'),
  'opaque-auth-value-12345',
  'opaque-auth-value-23456',
  'opaque-auth-value-34567',
  'opaque-azure-key-12345',
  'opaque-functions-key-12345',
];

describe('review activity', () => {
  it('把活动面板插在本轮用户消息和正文回复之间', () => {
    const messages: UIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: '请审查' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: '正文' }] },
    ];
    const state = updateReviewAgentActivity(createReviewActivityState('run-1'), primary, '2026-07-10T00:00:00.000Z');

    expect(upsertReviewActivityMessage(messages, state).map((message) => message.id)).toEqual([
      'u1',
      'review-activity-run-1',
      'a1',
    ]);
  });

  it('同一 Agent 更新时不重复追加，并保留开始时间', () => {
    const running = updateReviewAgentActivity(createReviewActivityState('run-1'), primary, '2026-07-10T00:00:00.000Z');
    const completed = updateReviewAgentActivity(
      running,
      { ...primary, task: '主审查完成', status: 'completed' },
      '2026-07-10T00:01:00.000Z',
    );

    expect(completed.agents).toHaveLength(1);
    expect(completed.agents[0]).toMatchObject({
      status: 'completed',
      startedAt: '2026-07-10T00:00:00.000Z',
      finishedAt: '2026-07-10T00:01:00.000Z',
    });
  });

  it('终止仍在运行的 Agent 时不改变整体阶段', () => {
    const running = updateReviewAgentActivity(
      { ...createReviewActivityState('run-1'), phase: 'verifying' },
      primary,
    );
    expect(failRunningReviewAgents(running)).toMatchObject({
      phase: 'verifying',
      agents: [{ id: 'primary', status: 'failed' }],
    });
  });

  it('把每一步文本、工具输入、输出与错误收敛为可持久化轨迹', () => {
    const step = {
      callId: 'call-1',
      stepNumber: 0,
      text: '已核对两个文件。',
      finishReason: 'tool-calls',
      toolCalls: [
        { toolCallId: 'read-1', toolName: 'read_file', input: { path: 'src/a.ts' } },
        { toolCallId: 'bash-1', toolName: 'bash', input: { command: 'rg token src' } },
      ],
      toolResults: [
        { toolCallId: 'read-1', output: 'source' },
      ],
      content: [
        { type: 'tool-error', toolCallId: 'bash-1', error: new Error('命令被拒绝') },
      ],
    } satisfies ReviewAgentTraceStepSource;

    const trace = appendReviewAgentTraceStep(createReviewAgentTrace('检查鉴权'), step);

    expect(trace).toEqual({
      input: '检查鉴权',
      steps: [{
        id: 'call-1:0',
        index: 1,
        text: '已核对两个文件。',
        finishReason: 'tool-calls',
        tools: [
          expect.objectContaining({
            toolCallId: 'read-1',
            state: 'output-available',
            input: expect.stringContaining('src/a.ts'),
          }),
          expect.objectContaining({ toolCallId: 'bash-1', state: 'output-error', errorText: '命令被拒绝' }),
        ],
      }],
    });
    expect(isReviewActivityState({
      runId: 'run-1',
      phase: 'reviewing',
      agents: [{ ...primary, trace }],
    })).toBe(true);
    const failedTrace = failReviewAgentTrace(completeReviewAgentTrace(trace, '检查完成'), '命令被拒绝');
    expect(failedTrace.errorText).toBe('命令被拒绝');
    expect(failedTrace).not.toHaveProperty('output');
  });

  it('拒绝步骤序号非法的轨迹载荷', () => {
    expect(isReviewActivityState({
      runId: 'run-1',
      phase: 'reviewing',
      agents: [{
        ...primary,
        trace: {
          input: '检查鉴权',
          steps: [{ id: 'bad', index: 0, text: '', finishReason: 'stop', tools: [] }],
        },
      }],
    })).toBe(false);
    expect(isReviewActivityState({
      runId: 'run-1',
      phase: 'completed',
      agents: [{ ...primary, status: 'completed', trace: { input: '检查鉴权', steps: [], output: '无问题' } }],
    })).toBe(true);
    expect(isReviewActivityState({
      runId: 'run-1',
      phase: 'completed',
      agents: [{ ...primary, status: 'completed', trace: { input: '检查鉴权', steps: [], output: { unsafe: true } } }],
    })).toBe(false);
  });

  it('脱敏并限制持久化轨迹体积', () => {
    let trace = createReviewAgentTrace(`检查 Authorization: Basic ${credentialSamples[2]}`);
    for (let index = 0; index < 40; index += 1) {
      trace = appendReviewAgentTraceStep(trace, {
        callId: 'bounded',
        stepNumber: index,
        text: `步骤 ${index}`,
        finishReason: 'tool-calls',
        toolCalls: [{
          toolCallId: `read-${index}`,
          toolName: 'read_file',
          input: { path: '.env', apiKey: credentialSamples[0], clientSecret: credentialSamples[1] },
        }],
        toolResults: [{
          toolCallId: `read-${index}`,
          output: `工具原始输出不得持久化：${credentialSamples[3]}`,
        }],
        content: [],
      });
    }
    trace = completeReviewAgentTrace(trace, [
      '普通输出：匹配到 src/auth.ts:42',
      `AWS_ACCESS_KEY_ID=${credentialSamples[3]}`,
      `JWT=${credentialSamples[4]}`,
      `NPM_TOKEN=${credentialSamples[5]}`,
      `SLACK_TOKEN=${credentialSamples[6]}`,
      `GOOGLE_TOKEN=${credentialSamples[7]}`,
      `DATABASE_URL=postgresql://user:${credentialSamples[8]}@localhost/db`,
      `CACHE_URL=redis://:${credentialSamples[9]}@cache/db`,
      `INTERNAL_URL=https://${credentialSamples[10]}@internal/path`,
      `{"token":"${credentialSamples[11]}"}`,
      `SERVICE_CREDENTIAL=${credentialSamples[12]}`,
      `AccountKey=${credentialSamples[13]}`,
      `AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=review;AccountKey=${credentialSamples[14]};EndpointSuffix=core.windows.net`,
      `{"auth":"${credentialSamples[13]}"}`,
      `_auth=${credentialSamples[13]}`,
      `API key: ${credentialSamples[15]}`,
      `STRIPE_KEY=${credentialSamples[16]}`,
      `STRIPE_RESTRICTED_KEY=${credentialSamples[17]}`,
      `STRIPE_WEBHOOK_SECRET=${credentialSamples[18]}`,
      `Authorization: ApiKey ${credentialSamples[19]}`,
      `Authorization: Token ${credentialSamples[20]}`,
      `Proxy-Authorization: Negotiate ${credentialSamples[21]}`,
      `Ocp-Apim-Subscription-Key: ${credentialSamples[22]}`,
      `X-Functions-Key: ${credentialSamples[23]}`,
      '{"apiKey":"plain-api-credential","clientSecret":"plain-client-secret"}',
      'x'.repeat(40_000),
    ].join('\n'));

    const serialized = JSON.stringify(trace);
    for (const credential of credentialSamples) expect(serialized).not.toContain(credential);
    expect(serialized).toContain('普通输出：匹配到 src/auth.ts:42');
    expect(serialized).not.toContain('工具原始输出不得持久化');
    expect(serialized).toContain('已脱敏');
    expect(serialized.length).toBeLessThanOrEqual(64_000);
    expect(trace.truncated).toBe(true);
    expect(trace.steps.length).toBeLessThanOrEqual(32);
  });

  it('脱敏返回主 Agent 的专项结论', () => {
    const result = sanitizeReviewAgentResult([
      `Authorization: Basic ${credentialSamples[2]}`,
      `AWS_ACCESS_KEY_ID=${credentialSamples[3]}`,
      `token=${credentialSamples[4]}`,
      `NPM_TOKEN=${credentialSamples[5]}`,
      `SLACK_TOKEN=${credentialSamples[6]}`,
      `GOOGLE_TOKEN=${credentialSamples[7]}`,
      `DATABASE_URL=postgresql://user:${credentialSamples[8]}@localhost/db`,
      `CACHE_URL=redis://:${credentialSamples[9]}@cache/db`,
      `INTERNAL_URL=https://${credentialSamples[10]}@internal/path`,
      `{"token":"${credentialSamples[11]}"}`,
      `SERVICE_CREDENTIAL=${credentialSamples[12]}`,
      `AccountKey=${credentialSamples[13]}`,
      `AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=review;AccountKey=${credentialSamples[14]};EndpointSuffix=core.windows.net`,
      `{"auth":"${credentialSamples[13]}"}`,
      `_auth=${credentialSamples[13]}`,
      `API key: ${credentialSamples[15]}`,
      `STRIPE_KEY=${credentialSamples[16]}`,
      `STRIPE_RESTRICTED_KEY=${credentialSamples[17]}`,
      `STRIPE_WEBHOOK_SECRET=${credentialSamples[18]}`,
      `Authorization: ApiKey ${credentialSamples[19]}`,
      `Authorization: Token ${credentialSamples[20]}`,
      `Proxy-Authorization: Negotiate ${credentialSamples[21]}`,
      `Ocp-Apim-Subscription-Key: ${credentialSamples[22]}`,
      `X-Functions-Key: ${credentialSamples[23]}`,
      '{"apiKey":"plain-api-credential","clientSecret":"plain-client-secret"}',
    ].join('\n'));

    for (const credential of credentialSamples) expect(result).not.toContain(credential);
    expect(result).toContain('已脱敏');
  });

  it('限制单次审查可持久化的 Agent 轨迹总数', () => {
    let state = createReviewActivityState('run-bounded');
    for (let index = 0; index < 40; index += 1) {
      state = updateReviewAgentActivity(state, {
        ...primary,
        id: `delegate-${index}`,
        status: 'running',
        trace: createReviewAgentTrace(`任务 ${index}`),
      });
    }

    expect(state.agents.filter((agent) => agent.trace)).toHaveLength(16);
    expect(state.agents).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'trace-overflow', status: 'completed' }),
    ]));
    expect(state.agents.length).toBeLessThanOrEqual(17);
  });
});
