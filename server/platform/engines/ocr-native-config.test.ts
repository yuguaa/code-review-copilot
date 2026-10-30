import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = path.resolve('temp', `ocr-native-config-${randomUUID()}`);
const workdir = path.join(root, 'repository');
const originalRoot = process.env.WORKSPACE_ROOT;
const execute = promisify(execFile);
let runOcr: typeof import('./ocr-engine').runOcr;
let baseSha: string;
let headSha: string;

beforeAll(async () => {
  await mkdir(workdir, { recursive: true });
  await execute('git', ['init', '--quiet', workdir]);
  const git = (args: string[]) => execute('git', ['-c', 'user.name=OCR native test', '-c', 'user.email=ocr@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-C', workdir, ...args]);
  await writeFile(path.join(workdir, 'example.ts'), 'export const value = 1;\n');
  await git(['add', 'example.ts']); await git(['commit', '--quiet', '-m', 'base']);
  baseSha = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await writeFile(path.join(workdir, 'example.ts'), 'export const value = 2;\n');
  await git(['commit', '--quiet', '-am', 'change']);
  headSha = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  process.env.WORKSPACE_ROOT = root;
  ({ runOcr } = await import('./ocr-engine'));
});

afterAll(() => { if (originalRoot === undefined) delete process.env.WORKSPACE_ROOT; else process.env.WORKSPACE_ROOT = originalRoot; });

async function captureRequest(repositoryId: string, id: string, modelId: string, apiKey: string) {
  const controller = new AbortController();
  const requests: Array<{ body: Record<string, any>; authorization?: string }> = [];
  let rejections = 0;
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const input = JSON.parse(body);
      requests.push({ body: input, authorization: request.headers.authorization });
      if (input.tool_choice && /deepseek/i.test(input.model) && input.thinking?.type !== 'disabled') {
        rejections += 1;
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'Thinking mode does not support this tool_choice' } }));
        return;
      }
      const finished = input.messages.some((message: { role: string }) => message.role === 'tool');
      let tool = 'code_comment';
      let args: Record<string, unknown> = { comments: [{ content: 'Local protocol fixture finding.',
        existing_code: 'export const value = 2;', category: 'bug', severity: 'medium' }] };
      if (input.tool_choice) { tool = 'approve_all_comments'; args = {}; }
      else if (finished) { tool = 'task_done'; args = { state: 'DONE' }; }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: 'native-completion', object: 'chat.completion', model: input.model,
        choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{
          id: tool, type: 'function', function: { name: tool, arguments: JSON.stringify(args) },
        }] } }], usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const timer = setTimeout(() => controller.abort(new Error('Native request-shape test timed out')), 10000);
  try {
    const result = await runOcr({ repositoryId, id, workdir, baseSha, headSha, background: 'Native request-shape verification.',
      concurrency: 1, timeoutMinutes: 1, maxTokensBudget: 2000000, traceparent: '', signal: controller.signal,
      model: { provider: 'openai-compatible', modelId, apiKey, apiBaseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, maxSteps: 1 },
    });
    expect(result.status).toBe('completed');
    expect(result.rawResult.status).toBe('complete');
    expect(rejections).toBe(0);
    expect(result.rawResult.comments).toHaveLength(1);
    const filterRequests = requests.filter((request) => request.body.tools?.some((tool: { function: { name: string } }) => tool.function.name === 'approve_all_comments'));
    expect(filterRequests).toHaveLength(1);
    expect(filterRequests[0].body.tool_choice).toBe('required');
    expect(requests.length).toBeGreaterThan(0);
    return requests;
  } finally {
    clearTimeout(timer); controller.abort(); server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('真实 OCR review 的模型配置解析', () => {
  it('不完整的旧兼容配置也必须让实际 DeepSeek 请求带上 thinking disabled，且不覆盖共享配置', async () => {
    const repositoryId = randomUUID();
    const configDir = path.join(root, repositoryId, 'ocr-home', '.opencodereview');
    await mkdir(configDir, { recursive: true });
    const existing = JSON.stringify({ llm: { extra_body: { thinking: { type: 'disabled' }, temperature: 0.2 } } });
    await writeFile(path.join(configDir, 'config.json'), existing);
    const id = randomUUID();
    const apiKey = `native-key-${randomUUID()}`;
    const requests = await captureRequest(repositoryId, id, 'deepseek-v4-pro', apiKey);
    expect(requests.every((request) => request.body.thinking?.type === 'disabled')).toBe(true);
    expect(requests.every((request) => request.authorization === `Bearer ${apiKey}`)).toBe(true);
    expect(requests.every((request) => request.body.temperature === 0.2)).toBe(true);
    expect(await readFile(path.join(configDir, 'config.json'), 'utf8')).toBe(existing);
    const runtimeConfig = await readFile(path.join(root, repositoryId, 'ocr-home', 'runs', id, '.opencodereview', 'config.json'), 'utf8');
    expect(runtimeConfig).not.toContain(apiKey);
    expect(await readdir(path.join(configDir, 'sessions'), { recursive: true })).toEqual(expect.arrayContaining([expect.stringMatching(/\.jsonl$/)]));
  });

  it('同仓库的并发模型地址和凭据隔离，普通模型不被注入 thinking', async () => {
    const repositoryId = randomUUID();
    const responses = await Promise.all([
      captureRequest(repositoryId, randomUUID(), 'deepseek-v4-pro', 'native-first-key'),
      captureRequest(repositoryId, randomUUID(), 'deepseek-flash', 'native-second-key'),
      captureRequest(repositoryId, randomUUID(), 'generic-chat', 'native-generic-key'),
    ]);
    expect(responses.map((requests) => [...new Set(requests.map((request) => request.authorization))])).toEqual([
      [expect.stringContaining('native-first-key')], [expect.stringContaining('native-second-key')], [expect.stringContaining('native-generic-key')],
    ]);
    expect(responses[0][0].body.thinking).toEqual({ type: 'disabled' });
    expect(responses[1][0].body.thinking).toEqual({ type: 'disabled' });
    expect(responses[2][0].body).not.toHaveProperty('thinking');
  });

  it('旧原生 provider 或凭据不能覆盖平台本轮的模型和认证信息', async () => {
    const repositoryId = randomUUID();
    const configDir = path.join(root, repositoryId, 'ocr-home', '.opencodereview');
    await mkdir(configDir, { recursive: true });
    const previous = JSON.stringify({ provider: 'old-provider', model: 'old-model',
      llm: { auth_token: 'old-api-token', auth_token_cmd: 'exit 99', extra_body: { thinking: { type: 'disabled' } } } });
    await writeFile(path.join(configDir, 'config.json'), previous);
    const id = randomUUID();
    const requests = await captureRequest(repositoryId, id, 'deepseek-flash', 'current-api-token');
    expect(requests.every((request) => request.body.model === 'deepseek-flash' && request.authorization === 'Bearer current-api-token')).toBe(true);
    const runtime = await readFile(path.join(root, repositoryId, 'ocr-home', 'runs', id, '.opencodereview', 'config.json'), 'utf8');
    expect(runtime).not.toContain('old-api-token');
    expect(runtime).not.toContain('current-api-token');
    expect(await readFile(path.join(configDir, 'config.json'), 'utf8')).toBe(previous);
  });
});
