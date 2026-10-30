import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, symlink, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { beforeAll, describe, expect, it } from 'vitest';

import { createChatTools, createRunDiagnosticTools, resolveWorkspacePath } from './read-tools';

const executeFile = promisify(execFile);
const directory = resolve('temp', `chat-tools-validation-${randomUUID()}`);
const root = resolve(directory, 'repository');
let tools: Awaited<ReturnType<typeof createChatTools>>;
let base: string;
let head: string;
let canonicalRoot: string;
const toolContext = {} as never;

function git(args: string[]): Promise<string> {
  return executeFile('git', args, { cwd: root, shell: false, timeout: 10_000 }).then(({ stdout }) => stdout.trim());
}

beforeAll(() => mkdir(root, { recursive: true })
  .then(() => git(['init']))
  .then(() => git(['config', 'user.name', 'Chat tools validation']))
  .then(() => git(['config', 'user.email', 'validation@example.invalid']))
  .then(() => Promise.all([
    writeFile(resolve(root, 'source.txt'), 'before\n'),
    writeFile(resolve(root, 'deleted.txt'), 'removed file\n'),
    writeFile(resolve(directory, 'outside.txt'), 'outside workspace\n'),
  ]))
  .then(() => git(['add', '.']))
  .then(() => git(['commit', '-m', 'base']))
  .then(() => git(['rev-parse', 'HEAD']))
  .then((sha) => { base = sha; return Promise.all([writeFile(resolve(root, 'source.txt'), 'after\nquery; printf forbidden\nthird line\n'), unlink(resolve(root, 'deleted.txt'))]); })
  .then(() => git(['add', '.']))
  .then(() => git(['commit', '-m', 'head']))
  .then(() => git(['rev-parse', 'HEAD']))
  .then((sha) => {
    head = sha;
    return Promise.all([
      realpath(root).then((resolved) => { canonicalRoot = resolved; }),
      symlink(resolve(directory, 'outside.txt'), resolve(root, 'outside-link')),
      symlink(resolve(root, 'source.txt'), resolve(root, 'inside-link')),
    ]);
  })
  .then(() => createChatTools({ dir: root, diffRef: base }, { baseSha: base, headSha: head }))
  .then((result) => { tools = result; }), 60_000);

describe('真实文件和 Git 只读工具', () => {
  it('代码工具只开放三个入口，读取指定行号', () => {
    expect(Object.keys(tools).sort()).toEqual(['git_diff', 'read_file', 'search']);
    return tools.read_file.execute('read', { path: 'source.txt', startLine: 2, lineCount: 1 }, undefined, undefined, toolContext)
      .then((output) => expect(output.details).toMatchObject({ startLine: 2, endLine: 2, content: '2: query; printf forbidden' }));
  });

  it('拒绝路径越界、外部符号链接和 Git 内部文件', () => Promise.all([
    expect(resolveWorkspacePath(canonicalRoot, '../outside.txt')).rejects.toThrow('仓库范围'),
    expect(resolveWorkspacePath(canonicalRoot, 'outside-link')).rejects.toThrow('仓库范围'),
    expect(resolveWorkspacePath(canonicalRoot, '.git/config')).rejects.toThrow('Git 内部'),
    expect(resolveWorkspacePath(canonicalRoot, resolve(root, 'source.txt'))).rejects.toThrow('相对路径'),
  ]));

  it('允许工作区内符号链接，并拒绝无效行号', () => tools.read_file.execute('read', { path: 'inside-link', startLine: 1, lineCount: 1 }, undefined, undefined, toolContext)
    .then((output) => {
      expect(output.details).toMatchObject({ content: '1: after' });
      return expect(tools.read_file.execute('read', { path: 'source.txt', startLine: 100, lineCount: 1 }, undefined, undefined, toolContext)).rejects.toThrow('行');
    }));

  it('搜索文本作为参数传递，空结果正常返回', () => tools.search.execute('search', { query: 'query; printf forbidden', path: '.' }, undefined, undefined, toolContext)
    .then((output) => {
      expect(output.details).toMatchObject({ content: expect.stringContaining('source.txt:2:query; printf forbidden') });
      return tools.search.execute('search', { query: 'absent search term', path: '.' }, undefined, undefined, toolContext);
    }).then((output) => expect(output.details).toEqual({ content: '' })));

  it('差异固定为选中 Run 的 base/head，并支持已删除文件', () => tools.git_diff.execute('diff', { path: 'deleted.txt' }, undefined, undefined, toolContext)
    .then((output) => expect(output.details).toMatchObject({ baseSha: base, headSha: head, content: expect.stringContaining('-removed file') })));

  it('工作区提交不匹配时不创建工具', () => expect(createChatTools({ dir: root, diffRef: base }, { baseSha: base, headSha: base })).rejects.toThrow('运行提交不一致'));

  it('校验 Pi 工具边界，并拒绝执行已经取消的读取', () => {
    const controller = new AbortController();
    controller.abort(new Error('已取消读取'));
    return Promise.all([
      expect(tools.read_file.execute('invalid', { path: 'source.txt', lineCount: 0 }, undefined, undefined, toolContext)).rejects.toThrow(),
      expect(tools.git_diff.execute('invalid', { path: 'source.txt', baseSha: base } as never, undefined, undefined, toolContext)).rejects.toThrow(),
      expect(tools.read_file.execute('cancelled', { path: 'source.txt' }, controller.signal, undefined, toolContext)).rejects.toThrow('已取消读取'),
    ]);
  });

  it('运行诊断工具返回失败原因和固定范围', () => createRunDiagnosticTools({
    id: 'failed-run',
    status: 'failed',
    error: 'OCR 审查失败：模型请求超时',
    report: '执行状态：failed',
    baseSha: base,
    startSha: base,
    headSha: head,
    provider: 'openai-compatible',
    modelId: 'validation-model',
    engineKey: 'ocr-review',
    engineVersion: '1.9.10',
    traceId: 'trace-validation',
    startedAt: new Date('2026-10-19T08:00:00.000Z'),
    finishedAt: new Date('2026-10-19T08:01:00.000Z'),
    deliveries: {},
  }).review_run_context.execute('context', {}, undefined, undefined, toolContext).then((output) => expect(output.details).toMatchObject({
    id: 'failed-run',
    status: 'failed',
    error: 'OCR 审查失败：模型请求超时',
    baseSha: base,
    headSha: head,
    traceId: 'trace-validation',
  })));
});
