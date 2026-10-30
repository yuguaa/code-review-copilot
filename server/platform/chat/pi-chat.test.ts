import { createUIMessageStream, readUIMessageStream } from 'ai';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Type } from 'typebox';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPiRuntime, definePiServiceTool } from '@server/platform/agent';
import { createChatStream } from './chat-stream';
import { streamPiMessages } from './pi-message-stream';

import type { ServerResponse } from 'node:http';
import type { Run } from '@prisma/client';
import type { UIMessage } from 'ai';
import type { PiRuntimeOptions } from '@server/platform/agent';
import type { SessionWithRepository } from '@server/modules/sessions/session-message-store.service';

const root = path.resolve('temp', `pi-chat-${randomUUID()}`);
const requests: Array<Record<string, any>> = [];
const authorizations = new Map<string, string | undefined>();
let respond: (request: Record<string, any>, response: ServerResponse) => void;
const server = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    const data = JSON.parse(body);
    requests.push(data);
    authorizations.set(data.model, request.headers.authorization);
    respond(data, response);
  });
});
let config: PiRuntimeOptions['modelConfig'];
const controller = () => new AbortController();
const question: UIMessage = { id: 'question', role: 'user', parts: [{ type: 'text', text: '解释失败原因' }] };

function sendChunks(response: ServerResponse, deltas: unknown[], finishReason = 'stop') {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const chunk = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({ id: `completion-${requests.length}`,
    object: 'chat.completion.chunk', created: 1, model: config.modelId, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  response.write(chunk({ role: 'assistant' }, null));
  for (const delta of deltas) response.write(chunk(delta, null));
  response.end(chunk({}, finishReason) + 'data: [DONE]\n\n');
}

function readMessages(stream: ReturnType<typeof createUIMessageStream>) {
  let last: UIMessage | undefined;
  return Promise.resolve().then(async () => {
    for await (const message of readUIMessageStream({ stream, terminateOnError: false })) last = message;
    return last;
  });
}

function runRuntime(overrides: Partial<PiRuntimeOptions> = {}, signal = controller().signal) {
  const errors: string[] = [];
  const saved: UIMessage[] = [];
  return createPiRuntime({ modelConfig: config, systemPrompt: 'Use only provided tools.', tools: [],
    cwd: root, signal, timeoutMs: 5000, ...overrides }).then((runtime) => {
    const stream = createUIMessageStream({ generateId: () => 'response', originalMessages: [question],
      execute: ({ writer }) => streamPiMessages(runtime, '本轮问题', writer, { signal, redact: (text) => text.replaceAll(config.apiKey, '[REDACTED]') }),
      onError: (error) => { const text = String(error).replaceAll(config.apiKey, '[REDACTED]'); errors.push(text); return text; },
      onStepEnd: ({ responseMessage }) => { saved.push(structuredClone(responseMessage)); },
    });
    return readMessages(stream).then((message) => ({ message, errors, saved, runtime }));
  });
}

beforeAll(() => mkdir(root, { recursive: true }).then(() => new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))).then(() => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('测试模型服务未启动');
  config = { provider: 'openai-compatible', modelId: 'deepseek-v4-pro', apiKey: 'local-provider-key',
    apiBaseUrl: `http://127.0.0.1:${address.port}/v1`, maxSteps: 4 };
}));
beforeEach(() => { requests.length = 0; authorizations.clear(); respond = (_request, response) => sendChunks(response, [{ content: '回答' }]); });
afterAll(() => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close((error) => error ? reject(error) : resolve()); }));

describe('真实 Pi SDK 与 UIMessageStream', () => {
  it('恢复数据库分支上下文，通过 Pi 完成诊断工具循环并流式显示推理、工具和文字', () => {
    respond = (_request, response) => requests.length === 1
      ? sendChunks(response, [{ reasoning_content: '核查已保存的运行状态。' }, { content: '先查看运行。' },
        { tool_calls: [{ index: 0, id: 'diagnostic', type: 'function', function: { name: 'review_run_context', arguments: '{}' } }] }], 'tool_calls')
      : sendChunks(response, [{ content: '失败原因是' }, { content: '模型超时。' }]);
    const run = { id: 'run', status: 'failed', error: '模型超时', reportMessageId: null, baseSha: null, headSha: null,
      startSha: null, provider: config.provider, modelId: config.modelId, engineKey: 'ocr', engineVersion: '1.9.10',
      traceId: 'trace', startedAt: null, finishedAt: null, deliveries: {} } as Run;
    const originalMessages: UIMessage[] = [
      { id: 'old-user', role: 'user', parts: [{ type: 'text', text: '上一轮问题' }] },
      { id: 'report', role: 'assistant', parts: [{ type: 'text', text: '数据库保存的审查报告' }] }, question,
    ];
    const signal = controller().signal;
    const errors: unknown[] = [];
    const saved: UIMessage[] = [];
    return createChatStream({ session: { repository: null } as SessionWithRepository, run, report: '已保存报告',
      messages: originalMessages, modelConfig: config, abortSignal: signal }).then((execute) => readMessages(createUIMessageStream({
        originalMessages, generateId: () => 'pi-response', execute: ({ writer }) => execute(writer),
        onError: (error) => { errors.push(error); return String(error); },
        onStepEnd: ({ responseMessage }) => { saved.push(structuredClone(responseMessage)); },
      }))).then((message) => {
        expect(errors).toEqual([]);
        expect(requests).toHaveLength(2);
        const first = requests[0];
        expect(first.messages.filter((item: any) => item.role === 'user').map((item: any) => typeof item.content === 'string'
          ? item.content : item.content.map((part: any) => part.text).join(''))).toEqual(['上一轮问题', '解释失败原因']);
        expect(JSON.stringify(first.messages)).toContain('数据库保存的审查报告');
        expect(first.thinking).toEqual({ type: 'disabled' });
        expect(first.messages[0].role).toBe('system');
        expect(first.max_tokens).toBe(8192);
        expect(first).not.toHaveProperty('max_completion_tokens');
        expect(first).not.toHaveProperty('store');
        expect(first.tools.map((tool: any) => tool.function.name).sort()).toEqual([
          'dingtalk_connections', 'dingtalk_contacts', 'dingtalk_message_draft', 'dingtalk_people_search', 'review_run_context',
        ]);
        expect(requests[1].messages.find((item: any) => item.role === 'tool')).toMatchObject({ tool_call_id: 'diagnostic', content: expect.stringContaining('模型超时') });
        expect(message).toMatchObject({ id: 'pi-response', role: 'assistant' });
        expect(message?.parts).toEqual(expect.arrayContaining([
          expect.objectContaining({ type: 'reasoning', text: '核查已保存的运行状态。', state: 'done' }),
          expect.objectContaining({ type: 'text', text: '先查看运行。', state: 'done' }),
          expect.objectContaining({ type: 'dynamic-tool', toolName: 'review_run_context', state: 'output-available', output: expect.objectContaining({ id: 'run', report: '模型超时' }) }),
          expect.objectContaining({ type: 'text', text: '失败原因是模型超时。', state: 'done' }),
        ]));
        expect(saved).toHaveLength(2);
        expect(saved[0].parts).toContainEqual(expect.objectContaining({ type: 'dynamic-tool', state: 'output-available' }));
      });
  });

  it('仅允许显式工具，不发现宿主机指令、不写 Pi 会话文件', () => writeFile(path.join(root, 'AGENTS.md'), 'HOST-INSTRUCTIONS-SHOULD-NOT-LEAK')
    .then(() => runRuntime()).then(({ errors, runtime }) => {
      expect(errors).toEqual([]);
      expect(requests).toHaveLength(1);
      expect(requests[0].tools ?? []).toHaveLength(0);
      expect(JSON.stringify(requests[0])).not.toContain('HOST-INSTRUCTIONS-SHOULD-NOT-LEAK');
      expect(runtime.session.sessionFile).toBeUndefined();
      expect(runtime.resourceLoader.getSkills().skills).toEqual([]);
      return expect(readFile(path.join(root, 'auth.json'))).rejects.toThrow('ENOENT');
    }));

  it('步骤上限在本步工具收尾后结束，不再请求模型', () => {
    let called = 0;
    respond = (_request, response) => sendChunks(response, [{ tool_calls: [{ index: 0, id: 'call', type: 'function', function: { name: 'echo', arguments: '{"text":"hello"}' } }] }], 'tool_calls');
    const echo = definePiServiceTool({ name: 'echo', label: 'Echo', description: 'Echo text',
      parameters: Type.Object({ text: Type.String() }, { additionalProperties: false }), execute: (input) => { called += 1; return input; } });
    return runRuntime({ tools: [echo], maxSteps: 1 }).then(({ errors, message }) => {
      expect(requests).toHaveLength(1);
      expect(called).toBe(1);
      expect(errors).toEqual([expect.stringContaining('1 步上限')]);
      expect(message?.parts).toContainEqual(expect.objectContaining({ type: 'dynamic-tool', state: 'output-available', output: { text: 'hello' } }));
    });
  });

  it('截断工具参数的自动续轮同样受步骤上限约束', () => {
    let called = 0;
    const echo = definePiServiceTool({ name: 'echo', label: 'Echo', description: 'Echo text',
      parameters: Type.Object({ text: Type.String() }, { additionalProperties: false }), execute: (input) => { called += 1; return input; } });
    respond = (_request, response) => sendChunks(response, [{ tool_calls: [{ index: 0, id: 'truncated', type: 'function', function: { name: 'echo', arguments: '{"text":"hello"}' } }] }], 'length');
    return runRuntime({ tools: [echo], maxSteps: 1 }).then(({ errors, message }) => {
      expect(requests).toHaveLength(1);
      expect(called).toBe(0);
      expect(errors).toEqual([expect.stringContaining('1 步上限')]);
      expect(message?.parts).toContainEqual(expect.objectContaining({ type: 'dynamic-tool', toolName: 'echo', state: 'output-error' }));
    });
  });

  it('不同工具轮次重复使用模型调用 ID 时，界面和持久化仍保留每次调用', () => {
    const tools = ['first', 'second'].map((name) => definePiServiceTool({ name, label: name, description: name,
      parameters: Type.Object({}, { additionalProperties: false }), execute: () => ({ name }) }));
    respond = (_request, response) => requests.length <= 2
      ? sendChunks(response, [{ tool_calls: [{ index: 0, id: 'call_0', type: 'function', function: { name: requests.length === 1 ? 'first' : 'second', arguments: '{}' } }] }], 'tool_calls')
      : sendChunks(response, [{ content: '结束' }]);
    return runRuntime({ tools, maxSteps: 4 }).then(({ errors, message, saved }) => {
      expect(errors).toEqual([]);
      expect(requests).toHaveLength(3);
      const calls = message?.parts.filter((part) => part.type === 'dynamic-tool');
      expect(calls).toHaveLength(2);
      expect(calls?.map((part) => ({ id: part.toolCallId, name: part.toolName, output: part.output }))).toEqual([
        { id: 'pi-tool-1-call_0', name: 'first', output: { name: 'first' } },
        { id: 'pi-tool-2-call_0', name: 'second', output: { name: 'second' } },
      ]);
      expect(saved[1].parts.filter((part) => part.type === 'dynamic-tool')).toHaveLength(2);
    });
  });

  it.each([400, 500])('模型返回 %s 上报错误且不自动重试', (status) => {
    respond = (_request, response) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { message: `invalid tool choice ${config.apiKey}` } })); };
    return runRuntime().then(({ errors }) => { expect(requests).toHaveLength(1); expect(errors).toEqual([expect.stringContaining('invalid tool choice [REDACTED]')]); });
  });

  it('普通兼容端点不注入 DeepSeek 专用 thinking 字段', () => runRuntime({ modelConfig: { ...config, modelId: 'generic-chat' } }).then(({ errors }) => {
    expect(errors).toEqual([]); expect(requests[0]).not.toHaveProperty('thinking');
  }));

  it('并行 Agent 使用各自的模型和内存凭据', () => Promise.all([
    runRuntime({ modelConfig: { ...config, modelId: 'chat-one', apiKey: 'runtime-one' } }),
    runRuntime({ modelConfig: { ...config, modelId: 'chat-two', apiKey: 'runtime-two' } }),
  ]).then((results) => {
    expect(results.map((result) => result.errors)).toEqual([[], []]);
    expect(requests).toHaveLength(2);
    expect(authorizations.get('chat-one')).toBe('Bearer runtime-one');
    expect(authorizations.get('chat-two')).toBe('Bearer runtime-two');
  }));

  it('安全测试可以从白名单路径加载指定 Skill', () => runRuntime({ skills: [{ name: 'hack', path: path.resolve('security-skills/hack') }] })
    .then(({ errors, runtime }) => {
      expect(errors).toEqual([]);
      expect(runtime.resourceLoader.getSkills().skills.map((skill) => skill.name)).toEqual(['hack']);
    }));

  it('超时取消正在等待的模型请求，并释放会话', () => {
    respond = () => undefined;
    return runRuntime({ timeoutMs: 300 }).then(({ errors, runtime }) => {
      expect(errors).toEqual([expect.stringContaining('Agent 执行超时')]);
      expect(runtime.session.isStreaming).toBe(false);
    });
  });

  it('用户停止时向 Pi 工具转发取消，结束传输后不再调用模型', () => {
    const cancellation = controller();
    let cancelled = false;
    const wait = definePiServiceTool({ name: 'wait', label: 'Wait', description: 'Wait for cancellation',
      parameters: Type.Object({}, { additionalProperties: false }), execute: (_input, signal) => new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => { cancelled = true; reject(signal.reason); }, { once: true });
        cancellation.abort(new Error('用户停止'));
      }) });
    respond = (_request, response) => sendChunks(response, [{ tool_calls: [{ index: 0, id: 'wait-call', type: 'function', function: { name: 'wait', arguments: '{}' } }] }], 'tool_calls');
    return runRuntime({ tools: [wait] }, cancellation.signal).then(({ errors, runtime }) => {
      expect(cancelled).toBe(true); expect(errors).toEqual([]); expect(requests).toHaveLength(1);
      expect(runtime.session.isStreaming).toBe(false);
    });
  });
});
