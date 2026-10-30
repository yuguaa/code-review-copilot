import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { Type } from 'typebox';

import { definePiServiceTool } from '@server/platform/agent';

const executeFile = promisify(execFile);
const pathSchema = Type.String({ minLength: 1, maxLength: 4096 });
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/i);

export function resolveWorkspacePath(root: string, requestedPath: string): Promise<string> {
  if (requestedPath.includes('\0') || path.isAbsolute(requestedPath)) {
    return Promise.reject(new Error('路径必须是仓库内的相对路径'));
  }
  const candidate = path.resolve(root, requestedPath);
  return realpath(candidate).then((resolved) => {
    const relative = path.relative(root, resolved);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('路径超出仓库范围');
    }
    if (relative.split(path.sep).includes('.git') || requestedPath.split(/[\\/]/).includes('.git')) {
      throw new Error('不能读取 Git 内部文件');
    }
    return resolved;
  });
}

export function createChatTools(workspace: { dir: string; diffRef: string | null }, run: { baseSha: string | null; headSha: string | null }) {
  const base = commitSchema.parse(run.baseSha);
  const head = commitSchema.parse(run.headSha);
  return realpath(workspace.dir).then((root) => {
    const executeGit = (args: string[], signal?: AbortSignal) => executeFile('git', [
      '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args,
    ], {
      cwd: root,
      shell: false,
      timeout: 10_000,
      maxBuffer: 2 * 1024 * 1024,
      signal,
      env: {
        PATH: process.env.PATH,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        GIT_LITERAL_PATHSPECS: '1',
      },
    }).then(({ stdout }) => stdout);
    return executeGit(['rev-parse', '--verify', 'HEAD']).then((checkedOutHead) => {
      if (checkedOutHead.trim() !== head) throw new Error('聊天工作区与运行提交不一致');
      return {
        read_file: definePiServiceTool({
          name: 'read_file', label: '读取代码',
          description: '读取本次运行 head 提交工作区内的文本文件，返回行号和内容。',
          parameters: Type.Object({
            path: pathSchema,
            startLine: Type.Optional(Type.Integer({ minimum: 1 })),
            lineCount: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
          }, { additionalProperties: false }),
          execute: ({ path: filePath, startLine = 1, lineCount = 200 }) => resolveWorkspacePath(root, filePath)
            .then((file) => open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK))
            .then((handle) => handle.stat().then((info) => {
              if (!info.isFile()) throw new Error('目标路径必须为普通文件');
              if (info.size > 1024 * 1024) throw new Error('文件超过 1 MiB，请指定更小的文件');
              const buffer = Buffer.alloc(1024 * 1024 + 1);
              return handle.read(buffer, 0, buffer.length, 0).then(({ bytesRead }) => {
                if (bytesRead > 1024 * 1024) throw new Error('文件超过 1 MiB，请指定更小的文件');
                return buffer.subarray(0, bytesRead);
              });
            }).finally(() => handle.close()))
            .then((buffer) => {
              if (buffer.includes(0)) throw new Error('不能读取二进制文件');
              const lines = buffer.toString('utf8').split('\n');
              if (startLine > lines.length) throw new Error('起始行超出文件范围');
              const selected = lines.slice(startLine - 1, startLine - 1 + lineCount);
              return {
                path: filePath,
                startLine,
                endLine: startLine + selected.length - 1,
                totalLines: lines.length,
                content: selected.map((line, index) => `${startLine + index}: ${line}`).join('\n'),
              };
            }),
        }),
        search: definePiServiceTool({
          name: 'search', label: '搜索代码',
          description: '在本次运行工作区搜索固定文本。path 必须为仓库内的文件或目录。',
          parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 1000 }), path: Type.Optional(pathSchema) }, { additionalProperties: false }),
          execute: ({ query, path: searchPath = '.' }, signal) => resolveWorkspacePath(root, searchPath)
            .then((resolved) => stat(resolved).then((info) => {
              if (!info.isDirectory() && !info.isFile()) throw new Error('搜索路径必须为文件或目录');
              return executeFile('rg', [
                '--no-config', '--line-number', '--fixed-strings', '--max-count', '50', '--max-columns', '4000',
                '--glob', '!.git', '--', query, path.relative(root, resolved) || '.',
              ], {
                cwd: root,
                shell: false,
                timeout: 10_000,
                maxBuffer: 2 * 1024 * 1024,
                signal,
                env: { PATH: process.env.PATH },
              }).then(({ stdout }) => ({ content: stdout }), (error: unknown) => {
                if (error && typeof error === 'object' && 'code' in error && error.code === 1) return { content: '' };
                throw error;
              });
            })),
        }),
        git_diff: definePiServiceTool({
          name: 'git_diff', label: '查看提交差异',
          description: '查看选中运行固定 base 与 head 提交之间的代码差异。',
          parameters: Type.Object({ path: Type.Optional(pathSchema) }, { additionalProperties: false }),
          execute: ({ path: filePath }, signal) => {
            /* Git 比较提交对象，已删除文件同样允许通过仓库相对路径查询。 */
            const relative = filePath ? path.relative(root, path.resolve(root, filePath)) : '';
            if (filePath && (path.isAbsolute(filePath) || filePath.includes('\0') || relative === '..'
              || relative.startsWith(`..${path.sep}`) || relative.split(path.sep).includes('.git'))) {
              throw new Error('差异路径必须位于仓库内');
            }
            return executeGit([
              'diff', '--no-ext-diff', '--no-textconv', '--no-color', '--src-prefix=a/', '--dst-prefix=b/',
              base, head, '--', ...(relative ? [relative] : []),
            ], signal).then((content) => ({ baseSha: base, headSha: head, content }));
          },
        }),
      };
    });
  });
}

export function createRunDiagnosticTools(run: RunDiagnostic) {
  const report = run.error || run.report?.trim() || '本次运行没有保存错误或报告正文';
  return {
    review_run_context: definePiServiceTool({
      name: 'review_run_context', label: '读取运行信息',
      description: '读取当前审查运行的状态、提交范围、模型、Trace、错误和已保存报告。',
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: () => ({
        id: run.id,
        status: run.status,
        error: run.error,
        report,
        baseSha: run.baseSha,
        startSha: run.startSha,
        headSha: run.headSha,
        provider: run.provider,
        modelId: run.modelId,
        engineKey: run.engineKey,
        engineVersion: run.engineVersion,
        traceId: run.traceId,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        deliveries: run.deliveries,
      }),
    }),
  };
}

export type RunDiagnostic = {
  id: string;
  status: string;
  error: string | null;
  report: string | null;
  baseSha: string | null;
  startSha: string | null;
  headSha: string | null;
  provider: string | null;
  modelId: string | null;
  engineKey: string;
  engineVersion: string | null;
  traceId: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  deliveries: unknown;
};
