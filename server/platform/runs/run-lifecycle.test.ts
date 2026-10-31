import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createServer as createModelServer } from 'node:http';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import EmbeddedPostgres from 'embedded-postgres';
import { serve } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { REVIEW_SCOPE_RULE } from './review-rule';

import type { Run } from '@prisma/client';

const executeFile = promisify(execFile);
const directory = resolve('temp', `run-lifecycle-${randomUUID()}`);
const originalEnv = { DATABASE_URL: process.env.DATABASE_URL, TMPDIR: process.env.TMPDIR, OTEL_SDK_DISABLED: process.env.OTEL_SDK_DISABLED };
let postgres: EmbeddedPostgres;
let databaseStarted = false;
let prisma: typeof import('@server/infrastructure/prisma/prisma.service').prisma;
let runs: typeof import('./run-service');
let publication: typeof import('./run-publication');
let chats: typeof import('../chat/chat-runtime');
let events: typeof import('@server/modules/sessions/session-events.service');
let repositoryId: string;
let modelId: string;

beforeAll(() => mkdir(directory, { recursive: true }).then(() => {
  process.env.TMPDIR = directory;
  process.env.OTEL_SDK_DISABLED = 'true';
  return new Promise<number>((accept, reject) => {
    const listener = createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address();
      if (!address || typeof address === 'string') return reject(new Error('无法取得测试端口'));
      listener.close((error) => error ? reject(error) : accept(address.port));
    });
  });
}).then((port) => {
  process.env.DATABASE_URL = `postgresql://run_validation:validation@127.0.0.1:${port}/postgres`;
  postgres = new EmbeddedPostgres({
    databaseDir: resolve(directory, 'database'), user: 'run_validation', password: 'validation', port,
    persistent: true, postgresFlags: ['-c', 'unix_socket_directories='],
  });
  return postgres.initialise().then(() => postgres.start()).then(() => { databaseStarted = true; });
}).then(() => executeFile(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.prisma', '--script'], {
  timeout: 30_000, maxBuffer: 1024 * 1024,
})).then(({ stdout }) => {
  const client = postgres.getPgClient('postgres');
  return client.connect().then(() => client.query(stdout)).finally(() => client.end());
}).then(() => Promise.all([
  import('@server/infrastructure/prisma/prisma.service'), import('./run-service'), import('./run-publication'),
  import('../chat/chat-runtime'), import('@server/modules/sessions/session-events.service'),
])).then(([database, runServices, publications, chatRuntime, sessionEvents]) => {
  prisma = database.prisma;
  runs = runServices;
  publication = publications;
  chats = chatRuntime;
  events = sessionEvents;
  return prisma.aIModel.create({ data: { provider: 'openai-compatible', modelId: 'validation', apiKey: randomUUID(), apiBaseUrl: 'http://127.0.0.1:1/v1', isDefault: true } });
}).then((model) => {
  modelId = model.id;
  return prisma.gitLabAccount.create({ data: { url: 'https://gitlab.example.invalid', accessToken: randomUUID() } });
}).then((account) => prisma.repository.create({ data: {
  gitLabAccountId: account.id, gitLabProjectId: 1, name: '运行流程验证', path: 'validation/project',
  defaultReviewPrompt: '仓库审查要求', enableMrComment: false, enableDingtalk: false,
} })).then((repository) => { repositoryId = repository.id; }), 60_000);

afterAll(() => Promise.resolve().then(() => runs?.stopRunWorker()).finally(() => prisma?.$disconnect())
  .finally(() => databaseStarted ? postgres.stop().then(() => { databaseStarted = false; }) : undefined)
  .finally(() => {
    for (const name of ['DATABASE_URL', 'TMPDIR', 'OTEL_SDK_DISABLED'] as const) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
  }), 60_000);

function createSession(): Promise<string> {
  return prisma.session.create({ data: {
    kind: 'review', repositoryId, status: 'completed', baseCommitSha: 'a'.repeat(40), commitSha: 'b'.repeat(40), mrTitle: '审查标题',
  } }).then((session) => session.id);
}

function enqueue(sessionId: string): Promise<void> {
  return runs.enqueueRun({ sessionId, baseSha: 'a'.repeat(40), startSha: 'a'.repeat(40), headSha: 'b'.repeat(40), triggerType: 'manual', background: '独立背景内容' });
}

function latest(sessionId: string): Promise<Run> {
  return prisma.run.findFirstOrThrow({ where: { sessionId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
}

function completedRun(): Promise<Run> {
  return createSession().then((sessionId) => enqueue(sessionId).then(() => runs.claimNextRun()).then((run) => {
    expect(run?.sessionId).toBe(sessionId);
    return runs.finishRun(run!.id, 'completed', null, { rawResult: { status: 'complete', comments: [] }, report: '本次报告正文', exitCode: 0 });
  }));
}

async function withNotificationFixture(mode: 'unique' | 'ambiguous' | 'unknown' | 'parallel' | 'wrong-employee' | 'disabled-repo' | 'changed-robot', operation: (sent: Array<{ userId: string; text: string }>, payloads: Array<Record<string, unknown>>) => Promise<void>) {
  const previous = { url: process.env.DINGTALK_WORKER_URL, token: process.env.DINGTALK_WORKER_TOKEN, publicUrl: process.env.APP_PUBLIC_URL };
  const model = await prisma.aIModel.findUniqueOrThrow({ where: { id: modelId } });
  const repository = await prisma.repository.findUniqueOrThrow({ where: { id: repositoryId }, select: { enableDingtalk: true, dingtalkRobotId: true } });
  const sent: Array<{ userId: string; text: string }> = [];
  const payloads: Array<Record<string, unknown>> = [];
  let webhookRobotId: string;
  const { createDingtalkWorker } = await import('@server/platform/dingtalk/cli-worker');
  const token = randomUUID();
  const worker = createDingtalkWorker(token, (input) => {
    if (input.action === 'auth-status') return Promise.resolve({ authenticated: true, tokenValid: true, profile: 'corp:user', userName: '授权人', corpName: '测试组织', reason: null });
    if (input.action === 'search') {
      expect(input.query).toBe('251111'); expect(input.dimension).toBe('jobNumber');
      return Promise.resolve({ people: [{ userId: 'verified-submitter', name: '提交人' }], returnedCount: mode === 'ambiguous' ? 2 : 1 });
    }
    if (input.action === 'person') {
      expect(input.userId).toBe('verified-submitter');
      const detail = { userId: input.userId, name: '提交人', employeeNo: mode === 'wrong-employee' ? 'different-employee' : '251111' };
      if (mode === 'changed-robot') return prisma.dingtalkRobot.findUniqueOrThrow({ where: { id: webhookRobotId } }).then((row) =>
        prisma.dingtalkRobot.update({ where: { id: row.id }, data: { webhookUrl: row.webhookUrl!.replace('/webhook', '/other-group') } })).then(() => detail);
      return mode === 'disabled-repo' ? prisma.repository.update({ where: { id: repositoryId }, data: { enableDingtalk: false } }).then(() => detail) : Promise.resolve(detail);
    }
    throw new Error('群通知不得调用个人私聊命令');
  });
  let workerServer: ReturnType<typeof serve>;
  const modelServer = createModelServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const input = JSON.parse(body);
      if (request.url?.startsWith('/webhook') || request.url?.startsWith('/other-group')) {
        payloads.push(input);
        sent.push({ userId: input.at?.atUserIds?.join(',') ?? '', text: input.markdown?.text ?? '' });
        if (mode === 'unknown') { request.socket.destroy(); return; }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ errcode: 0, errmsg: 'ok' }));
        return;
      }
      const result = input.messages.filter((item: any) => item.role === 'tool').at(-1);
      const lastAssistant = input.messages.filter((item: any) => item.role === 'assistant').at(-1);
      const lastTool = lastAssistant?.tool_calls?.at(-1)?.function?.name;
      const next = !result ? 'dingtalk_resolve_submitter' : lastTool === 'dingtalk_resolve_submitter' && mode !== 'ambiguous' ? 'dingtalk_notify_submitter' : null;
      const delta = next ? { role: 'assistant', tool_calls: Array.from({ length: mode === 'parallel' && next === 'dingtalk_notify_submitter' ? 2 : 1 }, (_, index) => ({
        index, id: `notify-${input.messages.length}-${index}`, type: 'function', function: { name: next, arguments: '{}' },
      })) } : { role: 'assistant', content: '通知流程已处理' };
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify({ id: 'notify', model: 'validation', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: next ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise<void>((resolve) => { workerServer = serve({ fetch: worker.fetch, port: 0, hostname: '127.0.0.1' }, (address) => { process.env.DINGTALK_WORKER_URL = `http://127.0.0.1:${address.port}`; resolve(); }); });
  await new Promise<void>((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
  process.env.DINGTALK_WORKER_TOKEN = token;
  process.env.APP_PUBLIC_URL = 'http://platform.example.invalid';
  await prisma.aIModel.update({ where: { id: modelId }, data: { apiBaseUrl: `http://127.0.0.1:${(modelServer.address() as { port: number }).port}/v1` } });
  const robot = await prisma.dingtalkRobot.create({ data: { name: '本地群报告机器人', webhookUrl: `http://127.0.0.1:${(modelServer.address() as { port: number }).port}/webhook`, secret: 'fixture-signing-secret' } });
  webhookRobotId = robot.id;
  await prisma.repository.update({ where: { id: repositoryId }, data: { enableDingtalk: true, dingtalkRobotId: robot.id } });
  const { ensureGlobalDingtalkCli } = await import('@server/modules/notifications/dingtalk-global.service');
  const global = await ensureGlobalDingtalkCli();
  await prisma.dingtalkRobot.update({ where: { id: global.id }, data: { enabled: true } });
  try { await operation(sent, payloads); } finally {
    workerServer!.close(); modelServer.closeAllConnections(); await new Promise<void>((resolve) => modelServer.close(() => resolve()));
    await prisma.aIModel.update({ where: { id: modelId }, data: { apiBaseUrl: model.apiBaseUrl } });
    await prisma.repository.update({ where: { id: repositoryId }, data: repository });
    for (const [key, value] of Object.entries({ DINGTALK_WORKER_URL: previous.url, DINGTALK_WORKER_TOKEN: previous.token, APP_PUBLIC_URL: previous.publicUrl })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

describe('运行事务、取消与重新执行', () => {
  it('入队时保存仓库审查规则快照', () => createSession().then((sessionId) => enqueue(sessionId)
    .then(() => latest(sessionId)).then((run) => {
      expect(run.input).toMatchObject({
        reviewRule: expect.stringContaining('仓库审查要求'), maxTokensBudget: 2_000_000,
      });
      expect(run.input).toMatchObject({ reviewRule: expect.stringContaining(REVIEW_SCOPE_RULE) });
      return runs.cancelSessionReview(sessionId);
    })));

  it('并发入队仅创建一个 Run 与输入消息', () => createSession().then((sessionId) => Promise.allSettled([enqueue(sessionId), enqueue(sessionId)])
    .then((results) => {
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
      return Promise.all([prisma.run.count({ where: { sessionId } }), prisma.message.count({ where: { sessionId } })]);
    }).then((counts) => {
      expect(counts).toEqual([1, 1]);
      return runs.cancelSessionReview(sessionId);
    })));

  it('在入队查询期间开始聊天，事务拒绝创建运行', () => createSession().then((sessionId) => {
    const pending = enqueue(sessionId);
    const release = chats.claimChatSession(sessionId);
    return expect(pending).rejects.toMatchObject({ status: 409 })
      .then(() => prisma.run.count({ where: { sessionId } }))
      .then((count) => expect(count).toBe(0)).finally(release);
  }));

  it('两个领取请求不会领取同一 Run，状态与 Session 同时更新', () => createSession().then((sessionId) => enqueue(sessionId)
    .then(() => Promise.all([runs.claimNextRun(), runs.claimNextRun()]))
    .then((claimed) => {
      expect(claimed.filter(Boolean)).toHaveLength(1);
      expect(claimed.find(Boolean)).toMatchObject({ sessionId, status: 'running', startedAt: expect.any(Date) });
      return prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    }).then((session) => {
      expect(session.status).toBe('running');
      return runs.cancelSessionReview(sessionId);
    }).then(() => expect(runs.enqueueSessionReview(sessionId)).rejects.toMatchObject({ status: 409 }))
    .then(() => latest(sessionId)).then((run) => runs.finishRun(run.id, 'completed', null))
    .then((run) => expect(run.status).toBe('cancelled'))));

  it('领取时也检查聊天互斥', () => createSession().then((sessionId) => enqueue(sessionId).then(() => {
    const release = chats.claimChatSession(sessionId);
    return runs.claimNextRun().then((run) => expect(run).toBeNull()).finally(release);
  }).then(() => runs.cancelSessionReview(sessionId))));

  it('领取与取消并发时，Run 与 Session 保持同一个状态', () => createSession().then((sessionId) => enqueue(sessionId)
    .then(() => Promise.all([runs.claimNextRun(), runs.cancelSessionReview(sessionId)]))
    .then(() => Promise.all([latest(sessionId), prisma.session.findUniqueOrThrow({ where: { id: sessionId } })]))
    .then(([run, session]) => {
      expect(['cancelled', 'cancelling']).toContain(run.status);
      expect(session.status).toBe(run.status);
      return runs.finishRun(run.id, 'completed', null);
    }).then((run) => expect(run.status).toBe('cancelled'))));

  it('重跑使用原始背景，仓库要求只出现一次', () => createSession().then((sessionId) => enqueue(sessionId)
    .then(() => latest(sessionId))
    .then((first) => runs.cancelSessionReview(sessionId).then(() => runs.enqueueSessionReview(sessionId))
      .then(() => latest(sessionId)).then((second) => {
        expect(second.input).toEqual(first.input);
        return runs.cancelSessionReview(sessionId);
      }).then(() => runs.enqueueSessionReview(sessionId)).then(() => latest(sessionId)).then((third) => {
        expect(third.input).toEqual(first.input);
        return runs.cancelSessionReview(sessionId);
      }))));

  it('旧任务结束不会更改新运行或新消息分支', () => createSession().then((sessionId) => enqueue(sessionId)
    .then(() => latest(sessionId)).then((oldRun) => runs.cancelSessionReview(sessionId)
      .then(() => runs.enqueueSessionReview(sessionId)).then(() => latest(sessionId))
      .then((newRun) => runs.finishRun(oldRun.id, 'failed', '旧任务错误').then(() => prisma.session.findUniqueOrThrow({ where: { id: sessionId } }))
        .then((session) => {
          expect(session.status).toBe('queued');
          expect(session.activeLeafMessageId).toBe(newRun.inputMessageId);
          expect(session.error).toBeNull();
          return runs.cancelSessionReview(sessionId);
        })))));

  it('并发完成同一任务只创建一条报告', () => createSession().then((sessionId) => enqueue(sessionId).then(() => runs.claimNextRun())
    .then((run) => Promise.all([runs.finishRun(run!.id, 'completed', null), runs.finishRun(run!.id, 'failed', '后续错误')]))
    .then((finished) => {
      expect(finished[0].reportMessageId).toBe(finished[1].reportMessageId);
      return prisma.message.count({ where: { sessionId, role: 'assistant' } });
    }).then((count) => expect(count).toBe(1))));

  it('模型快照变化时保存失败与报告，并返回错误，不调用模型', () => createSession().then((sessionId) => enqueue(sessionId)
    .then(() => runs.claimNextRun()).then((run) => prisma.aIModel.update({ where: { id: modelId }, data: { modelId: 'changed' } })
      .then(() => expect(runs.executeRun(run!.id, new AbortController().signal)).rejects.toThrow('模型配置已变更'))
      .then(() => latest(sessionId)).then((failed) => {
        expect(failed.status).toBe('failed');
        expect(failed.finishedAt).toBeInstanceOf(Date);
        expect(failed.error).toContain('模型配置已变更');
        expect(failed.reportMessageId).toBeTruthy();
      }).finally(() => prisma.aIModel.update({ where: { id: modelId }, data: { modelId: 'validation' } })))));

  it('排队与取消广播对应状态及消息', () => createSession().then((sessionId) => {
    const reader = events.subscribeSessionEvents(sessionId).getReader();
    return reader.read().then(() => enqueue(sessionId)).then(() => runs.cancelSessionReview(sessionId))
      .then(() => reader.read()).then((queued) => {
        expect(new TextDecoder().decode(queued.value)).toContain('"status":"queued"');
        return reader.read();
      }).then((cancelled) => {
        expect(new TextDecoder().decode(cancelled.value)).toContain('"status":"cancelled"');
        return reader.read();
      }).then((messages) => {
        expect(new TextDecoder().decode(messages.value)).toContain('event: messages');
      }).finally(() => reader.cancel());
  }));
});

describe('发布资格与恢复', () => {
  it('钉钉审查消息包含项目、提交人、提交范围和定位链接', () => {
    const message = publication.buildDingtalkReviewMessage({
      report: '本次报告正文', runId: 'run-1', triggerType: 'merge_request', baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40),
      publicUrl: 'http://platform.example/', repository: { name: '项目名称', path: 'team/repository', gitLabUrl: 'https://gitlab.example/' },
      session: { author: '提交人', sourceBranch: 'feature', targetBranch: 'main', mrIid: 12 },
    });
    expect(message.title).toBe('[代码审查] 项目名称');
    expect(message.text).toContain('项目：项目名称（team/repository）');
    expect(message.text).toContain('提交人：提交人');
    expect(message.text).toContain(`${'a'.repeat(40)} → ${'b'.repeat(40)}`);
    expect(message.text).toContain('https://gitlab.example/team/repository/-/merge_requests/12');
    expect(message.text).toContain('http://platform.example/runs/run-1');
    expect(message.text).toContain('本次报告正文');
  });

  it('并发领取同一渠道仅获得一次资格，其他渠道独立保存', () => completedRun().then((run) => prisma.repository.update({ where: { id: repositoryId }, data: { enableMrComment: true, enableDingtalk: true } })
    .then(() => Promise.all([publication.claimRunDelivery(run.id, 'gitlab', true), publication.claimRunDelivery(run.id, 'gitlab', true)]))
    .then((claims) => {
      const claim = claims.find(Boolean)!;
      expect(claims.filter(Boolean)).toHaveLength(1);
      return publication.claimRunDelivery(run.id, 'dingtalk', true).then((other) => Promise.all([
        publication.saveRunDelivery(run.id, 'gitlab', claim.attemptId, { status: 'sent', remoteIds: ['discussion'], noteIds: [42] }),
        publication.saveRunDelivery(run.id, 'dingtalk', other!.attemptId, { status: 'unknown', error: '发送结果需要确认' }),
      ]));
    }).then(() => prisma.run.findUniqueOrThrow({ where: { id: run.id } })).then((saved) => {
      expect(saved.deliveries).toMatchObject({ gitlab: { status: 'sent', remoteIds: ['discussion'], noteIds: [42] }, dingtalk: { status: 'unknown' } });
      return publication.claimRunDelivery(run.id, 'gitlab', true);
    }).then((claim) => expect(claim).toBeNull())
    .finally(() => prisma.repository.update({ where: { id: repositoryId }, data: { enableMrComment: false, enableDingtalk: false } }))));

  it('已发送和结果未知的记录不会被停用渠道覆盖', () => completedRun().then((run) => prisma.run.update({ where: { id: run.id }, data: { deliveries: {
    gitlab: { status: 'sent', remoteIds: ['existing'] }, dingtalk: { status: 'unknown', attemptId: 'previous' },
  } } }).then(() => Promise.all([publication.publishRun(run.id, 'gitlab', true), publication.publishRun(run.id, 'dingtalk', true)]))
    .then(() => prisma.run.findUniqueOrThrow({ where: { id: run.id } }))
    .then((saved) => expect(saved.deliveries).toMatchObject({ gitlab: { status: 'sent', remoteIds: ['existing'] }, dingtalk: { status: 'unknown' } }))));

  it('启用通知但缺少机器人时持久化 failed，不发送网络请求', () => completedRun().then((run) => prisma.repository.update({ where: { id: repositoryId }, data: { enableDingtalk: true } })
    .then(() => expect(publication.publishRun(run.id, 'dingtalk', true)).rejects.toBeInstanceOf(publication.PublicationError))
    .then(() => prisma.run.findUniqueOrThrow({ where: { id: run.id } }))
    .then((saved) => expect(saved.deliveries).toMatchObject({ dingtalk: { status: 'failed' } }))
    .finally(() => prisma.repository.update({ where: { id: repositoryId }, data: { enableDingtalk: false } }))));

  it('重启把 sending 改为 unknown，自动执行不重新发送，手动操作签发新资格', () => completedRun().then((run) => prisma.repository.update({ where: { id: repositoryId }, data: { enableMrComment: true } })
    .then(() => publication.claimRunDelivery(run.id, 'gitlab', true)).then((oldClaim) => publication.recoverRunPublications()
      .then(() => publication.claimRunDelivery(run.id, 'gitlab', false)).then((automatic) => {
        expect(automatic).toBeNull();
        return publication.claimRunDelivery(run.id, 'gitlab', true);
      }).then((claim) => {
        expect(claim!.attemptId).not.toBe(oldClaim!.attemptId);
        return expect(publication.saveRunDelivery(run.id, 'gitlab', oldClaim!.attemptId, { status: 'sent' })).rejects.toThrow('发布结果保存失败')
          .then(() => publication.saveRunDelivery(run.id, 'gitlab', claim!.attemptId, { status: 'sent' }));
      }))
    .finally(() => prisma.repository.update({ where: { id: repositoryId }, data: { enableMrComment: false } }))));

  it('报告指向其他会话时拒绝发布', () => completedRun().then((run) => createSession().then((sessionId) => prisma.message.create({ data: {
    sessionId, role: 'assistant', parts: [{ type: 'text', text: '其他会话报告' }],
  } })).then((message) => prisma.run.update({ where: { id: run.id }, data: { reportMessageId: message.id } }))
    .then(() => prisma.repository.update({ where: { id: repositoryId }, data: { enableMrComment: true } }))
    .then(() => expect(publication.claimRunDelivery(run.id, 'gitlab', true)).rejects.toMatchObject({ status: 409 }))
    .finally(() => prisma.repository.update({ where: { id: repositoryId }, data: { enableMrComment: false } }))));

  it('OCR 没有发现问题时只发原群报告，不 @ 人或私聊', () => withNotificationFixture('unique', async (sent) => {
    const run = await completedRun();
    await publication.publishRun(run.id, 'dingtalk', false);
    expect(sent).toEqual([{ userId: '', text: expect.stringContaining('本次报告正文') }]);
  }));

  it('未配置共享 CLI 时跳过问题通知，不把未启用记成失败', async () => {
    const run = await completedRun();
    await prisma.run.update({ where: { id: run.id }, data: { rawResult: { status: 'complete', comments: [{ path: 'src/form.ts', start_line: 5, end_line: 5, content: '存在问题' }] } } });
    await publication.publishRun(run.id, 'dingtalk', false);
    expect((await prisma.run.findUniqueOrThrow({ where: { id: run.id } })).deliveries).toMatchObject({ dingtalk: { status: 'skipped' } });
  });

  it('停用全局 CLI 只关闭 @，仍发送原机器人群报告', () => withNotificationFixture('unique', async (sent) => {
    const { ensureGlobalDingtalkCli } = await import('@server/modules/notifications/dingtalk-global.service');
    const connection = await ensureGlobalDingtalkCli();
    await prisma.dingtalkRobot.update({ where: { id: connection.id }, data: { enabled: false } });
    try {
      const run = await completedRun();
      await prisma.run.update({ where: { id: run.id }, data: { rawResult: { status: 'complete', comments: [{ path: 'src/form.ts', start_line: 5, end_line: 5, content: '存在问题' }] } } });
      await publication.publishRun(run.id, 'dingtalk', false);
      expect(sent).toEqual([{ userId: '', text: expect.stringContaining('本次报告正文') }]);
      expect((await prisma.run.findUniqueOrThrow({ where: { id: run.id } })).deliveries).toMatchObject({ dingtalk: { status: 'sent' } });
    } finally { await prisma.dingtalkRobot.update({ where: { id: connection.id }, data: { enabled: true } }); }
  }));

  it('MR 通知记录实际作者的工号，不把操作 Webhook 的用户当成作者', async () => {
    const repo = await prisma.repository.findUniqueOrThrow({ where: { id: repositoryId }, include: { gitLabAccount: true } });
    const token = randomUUID();
    const server = createModelServer((request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(new URL(request.url ?? '/', 'http://gitlab-fixture').pathname.endsWith('/versions')
        ? [{ id: 1, base_commit_sha: 'a'.repeat(40), start_commit_sha: 'a'.repeat(40), head_commit_sha: 'b'.repeat(40) }]
        : { id: 42, iid: 10, author: { id: 42, name: 'MR 作者', username: '251111' } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      await prisma.gitLabAccount.update({ where: { id: repo.gitLabAccountId }, data: { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, webhookSecret: token } });
      const { handleGitLabWebhook } = await import('@server/modules/webhook/webhook.service');
      const result = await handleGitLabWebhook({ event: 'Merge Request Hook', token, body: {
        project: { id: repo.gitLabProjectId }, user: { name: '操作人', username: '999999' },
        object_attributes: { iid: 10, title: 'MR 身份验证', source_branch: 'feature', target_branch: 'main', action: 'update', last_commit: { id: 'b'.repeat(40) } },
      } });
      const session = await prisma.session.findUniqueOrThrow({ where: { id: result.body.sessionId! } });
      expect(session).toMatchObject({ author: 'MR 作者', authorUsername: '251111' });
      await runs.cancelSessionReview(session.id);
    } finally {
      server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
      await prisma.gitLabAccount.update({ where: { id: repo.gitLabAccountId }, data: { url: repo.gitLabAccount.url, webhookSecret: repo.gitLabAccount.webhookSecret } });
    }
  });

  it('OCR 问题报告只向原机器人群发送一条，并 @ 已核实提交人，不私聊', () => withNotificationFixture('unique', async (sent, payloads) => {
    const run = await completedRun();
    await prisma.session.update({ where: { id: run.sessionId }, data: { author: '提交人', authorUsername: '251111' } });
    await prisma.run.update({ where: { id: run.id }, data: { rawResult: { status: 'complete', comments: [{ path: 'src/form.ts', start_line: 5, end_line: 5, content: '存在重复提交问题' }] } } });
    await Promise.all([publication.publishRun(run.id, 'dingtalk', false), publication.publishRun(run.id, 'dingtalk', false)]);
    expect(sent).toEqual([{ userId: 'verified-submitter', text: expect.stringContaining(`/runs/${run.id}`) }]);
    expect(sent[0].text).toMatch(/^@verified-submitter\s/);
    expect(sent[0].text).toContain('本次报告正文');
    expect(payloads).toHaveLength(1);
    expect(payloads[0].at).toEqual({ atUserIds: ['verified-submitter'], isAtAll: false });
    const saved = await prisma.run.findUniqueOrThrow({ where: { id: run.id } });
    expect(saved.deliveries).toMatchObject({ dingtalk: { status: 'sent', steps: expect.arrayContaining(['dingtalk_notify_submitter：完成']) } });
    expect(saved.deliveries).not.toHaveProperty('dingtalk-cli');
  }));

  it('工号不能唯一核实则停止通知，不按名字或 GitLab ID 猜测', () => withNotificationFixture('ambiguous', async (sent) => {
    const run = await completedRun();
    await prisma.session.update({ where: { id: run.sessionId }, data: { authorUsername: '251111' } });
    await prisma.run.update({ where: { id: run.id }, data: { rawResult: { status: 'partial', comments: [{ path: 'src/form.ts', start_line: 5, end_line: 5, content: '存在问题' }] } } });
    await expect(publication.publishRun(run.id, 'dingtalk', false)).rejects.toBeInstanceOf(publication.PublicationError);
    expect(sent).toHaveLength(0);
    expect((await prisma.run.findUniqueOrThrow({ where: { id: run.id } })).deliveries).toMatchObject({ dingtalk: { status: 'failed' } });
  }));

  it('Pi 同一轮并行请求两次通知时，只发送一条群报告', () => withNotificationFixture('parallel', async (sent) => {
    const run = await completedRun();
    await prisma.session.update({ where: { id: run.sessionId }, data: { authorUsername: '251111' } });
    await prisma.run.update({ where: { id: run.id }, data: { rawResult: { status: 'complete', comments: [{ path: 'src/form.ts', start_line: 5, end_line: 5, content: '存在问题' }] } } });
    await publication.publishRun(run.id, 'dingtalk', false);
    expect(sent).toHaveLength(1);
    expect((await prisma.run.findUniqueOrThrow({ where: { id: run.id } })).deliveries).toMatchObject({ dingtalk: { status: 'sent' } });
  }));

  it('群发送结果未知时记录 unknown，自动通知不会重发', () => withNotificationFixture('unknown', async (sent) => {
    const run = await completedRun();
    await prisma.session.update({ where: { id: run.sessionId }, data: { authorUsername: '251111' } });
    await prisma.run.update({ where: { id: run.id }, data: { rawResult: { status: 'complete', comments: [{ path: 'src/form.ts', start_line: 5, end_line: 5, content: '存在问题' }] } } });
    await expect(publication.publishRun(run.id, 'dingtalk', false)).rejects.toBeInstanceOf(publication.PublicationError);
    expect((await prisma.run.findUniqueOrThrow({ where: { id: run.id } })).deliveries).toMatchObject({ dingtalk: { status: 'unknown' } });
    await publication.publishRun(run.id, 'dingtalk', false);
    expect(sent).toHaveLength(1);
  }));

  it.each(['wrong-employee', 'disabled-repo', 'changed-robot'] as const)('工号不符或查人中群配置变化时停止发送：%s', (mode) => withNotificationFixture(mode, async (sent) => {
    const run = await completedRun();
    await prisma.session.update({ where: { id: run.sessionId }, data: { authorUsername: '251111' } });
    await prisma.run.update({ where: { id: run.id }, data: { rawResult: { status: 'complete', comments: [{ path: 'src/form.ts', start_line: 5, end_line: 5, content: '存在问题' }] } } });
    await expect(publication.publishRun(run.id, 'dingtalk', false)).rejects.toBeInstanceOf(publication.PublicationError);
    expect(sent).toHaveLength(0);
  }));

  it('旧独立 CLI 私聊发布入口停用，不产生发送资格', async () => {
    const run = await completedRun();
    await expect(publication.publishRun(run.id, 'dingtalk-cli', true)).rejects.toMatchObject({ status: 410 });
    expect((await prisma.run.findUniqueOrThrow({ where: { id: run.id } })).deliveries).not.toHaveProperty('dingtalk-cli');
  });

  it('重启结束丢失进程的任务，同时保留排队任务', () => Promise.all([createSession(), createSession()]).then(([runningSession, queuedSession]) => enqueue(runningSession)
    .then(() => runs.claimNextRun()).then((claimed) => enqueue(queuedSession)
      .then(() => runs.recoverRunWorkerState()).then(() => Promise.all([latest(runningSession), latest(queuedSession)]))
      .then(([interrupted, queued]) => {
        expect(interrupted.id).toBe(claimed!.id);
        expect(interrupted.status).toBe('interrupted');
        expect(interrupted.reportMessageId).toBeTruthy();
        expect(queued.status).toBe('queued');
        return runs.cancelSessionReview(queuedSession);
      }))));

  it('真实 OCR 版本检查后可以启动、关闭并重新启动空队列执行器', () => runs.startRunWorker()
    .then(() => expect(runs.startRunWorker()).rejects.toThrow('已经启动'))
    .then(() => runs.stopRunWorker()).then(() => runs.startRunWorker()).then(() => runs.stopRunWorker()));

  it('并发重复请求只保留一个会话，不同提交共用请求标识时返回冲突', () => import('./run-trigger').then(({ createReviewSession }) => {
    const eventKey = `manual:${randomUUID()}`;
    const seed = { repositoryId, title: '并发审查请求', baseCommitSha: 'a'.repeat(40), commitSha: 'b'.repeat(40) };
    const request = { eventKey, triggerType: 'manual' as const, baseSha: 'a'.repeat(40), startSha: 'a'.repeat(40), headSha: 'b'.repeat(40) };
    return Promise.all([createReviewSession(seed, request), createReviewSession(seed, request)]).then(([first, second]) => {
      expect(first.runId).toBe(second.runId);
      expect(first.sessionId).toBe(second.sessionId);
      return prisma.session.count({ where: { repositoryId, title: seed.title } }).then((count) => expect(count).toBe(1))
        .then(() => expect(createReviewSession({ ...seed, commitSha: 'c'.repeat(40) }, { ...request, headSha: 'c'.repeat(40) })).rejects.toMatchObject({ status: 409 }))
        .then(() => runs.cancelSessionReview(first.sessionId));
    });
  }));

  it('数据库查询失败向调用方返回错误', () => prisma.$disconnect().then(() => postgres.stop()).then(() => {
    databaseStarted = false;
    return Promise.all([
      expect(runs.claimNextRun()).rejects.toThrow(),
      expect(publication.publishRun('unavailable', 'gitlab', true)).rejects.toThrow(),
    ]);
  }).then(() => undefined));
});
