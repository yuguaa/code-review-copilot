import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createServer as createModelServer } from 'node:http';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import EmbeddedPostgres from 'embedded-postgres';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { UIMessage } from 'ai';

const executeFile = promisify(execFile);
const directory = resolve('temp', `sessions-validation-${randomUUID()}`);
const originalEnv = { DATABASE_URL: process.env.DATABASE_URL, TMPDIR: process.env.TMPDIR };
let postgres: EmbeddedPostgres;
let prisma: typeof import('@server/infrastructure/prisma/prisma.service').prisma;
let store: typeof import('./session-message-store.service');
let services: typeof import('./sessions.service');
let chat: typeof import('../chat/chat.service');
let dingtalkMessages: typeof import('../notifications/dingtalk-messages.service');
let app: Hono;
let firstSession: string;
let secondSession: string;
let questionId: string;

beforeAll(() => mkdir(directory, { recursive: true }).then(() => {
  process.env.TMPDIR = directory;
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
  process.env.DATABASE_URL = `postgresql://session_validation:validation@127.0.0.1:${port}/postgres`;
  postgres = new EmbeddedPostgres({
    databaseDir: resolve(directory, 'database'), user: 'session_validation', password: 'validation', port,
    persistent: true, postgresFlags: ['-c', 'unix_socket_directories='],
  });
  return postgres.initialise().then(() => postgres.start());
}).then(() => executeFile(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.prisma', '--script'], {
  timeout: 30_000, maxBuffer: 1024 * 1024,
})).then(({ stdout }) => {
  const client = postgres.getPgClient('postgres');
  return client.connect().then(() => client.query(stdout)).finally(() => client.end());
}).then(() => Promise.all([
  import('@server/infrastructure/prisma/prisma.service'), import('./session-message-store.service'), import('./sessions.service'),
  import('../chat/chat.service'), import('./sessions.routes'),
  import('../notifications/dingtalk-messages.service'),
])).then(([database, messageStore, sessionServices, chatServices, routes, messages]) => {
  prisma = database.prisma;
  store = messageStore;
  services = sessionServices;
  chat = chatServices;
  dingtalkMessages = messages;
  app = new Hono().route('/sessions', routes.sessionRoutes);
  return Promise.all([services.createChatSession({}), services.createChatSession({})]);
}).then(([first, second]) => { firstSession = first.id; secondSession = second.id; }), 60_000);

afterAll(() => Promise.resolve().then(() => prisma?.$disconnect()).finally(() => postgres?.stop()).finally(() => {
  for (const name of ['DATABASE_URL', 'TMPDIR'] as const) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
}), 60_000);

function message(id: string, text: string, role: UIMessage['role'] = 'user'): UIMessage {
  return { id, role, parts: [{ type: 'text', text }] };
}

describe('真实 PostgreSQL 会话与消息树', () => {
  it('创建并读取完整分支，父消息切换保持其他分支', () => {
    const root = message(randomUUID(), '请审查');
    const report = message(randomUUID(), '已保存报告', 'assistant');
    const otherReport = message(randomUUID(), '另一个报告', 'assistant');
    return store.saveMessages(firstSession, [root, report])
      .then(() => store.saveMessages(firstSession, [root, otherReport]))
      .then(() => store.setActiveMessage(firstSession, report.id))
      .then((tree) => {
        expect(tree.activePathIds).toEqual([root.id, report.id]);
        expect(tree.messageTree).toHaveLength(3);
        return store.setActiveMessage(firstSession, root.id);
      }).then((tree) => expect(tree.activeLeafMessageId).toBe(otherReport.id));
  });

  it('跨会话 ID 无法更改消息内容或会话指针', () => store.loadMessages(firstSession).then((messages) => {
    const stolen = message(messages[0].id, '被改写的内容');
    return expect(store.saveMessages(secondSession, [stolen])).rejects.toMatchObject({ status: 409 })
      .then(() => store.loadMessages(firstSession))
      .then((persisted) => {
        expect(persisted[0].parts).toEqual(messages[0].parts);
        return expect(store.setActiveMessage(secondSession, messages[0].id)).rejects.toMatchObject({ status: 404 });
      });
  }));

  it('只保存当前用户问题，数据库报告保持原始内容', () => store.loadMessages(firstSession).then((history) => {
    questionId = randomUUID();
    return chat.validateChatRequest({
      sessionId: firstSession,
      messages: [message(history.at(-1)!.id, '浏览器改写报告', 'assistant'), message(questionId, '解释已有报告')],
    }).then(chat.acceptChatTurn).then((turn) => {
      expect(turn.messages.at(-2)?.parts).toEqual(history.at(-1)?.parts);
      expect(turn.messages.at(-1)?.id).toBe(questionId);
      return prisma.message.findUniqueOrThrow({ where: { id: questionId } });
    }).then((saved) => expect(saved.parentId).toBe(history.at(-1)?.id));
  }));

  it('重复用户 ID 拒绝写入', () => Promise.all([
    expect(chat.acceptChatTurn({ sessionId: secondSession, userMessage: message(questionId, '改写') })).rejects.toMatchObject({ status: 409 }),
  ]).then(() => prisma.message.count({ where: { sessionId: secondSession } })).then((count) => expect(count).toBe(0)));

  it('回复按服务端 ID 写入，反复保存只更新该回复', () => {
    const id = randomUUID();
    return chat.persistChatResponse(firstSession, questionId, id, message(id, '回答第一部分', 'assistant'))
      .then(() => chat.persistChatResponse(firstSession, questionId, id, message(id, '完整回答', 'assistant')))
      .then(() => store.loadSessionMessageTree(firstSession))
      .then((tree) => {
        expect(tree.activeLeafMessageId).toBe(id);
        expect(tree.messages.at(-1)?.parts).toEqual([{ type: 'text', text: '完整回答' }]);
        return expect(chat.persistChatResponse(secondSession, questionId, randomUUID(), message(randomUUID(), '其他回答', 'assistant'))).rejects.toThrow();
      });
  });

  it('运行必须属于当前会话，失败运行也可以继续对话', () => store.loadMessages(firstSession).then((history) => {
    const reportMessageId = history.at(-1)!.id;
    return prisma.run.create({ data: {
      sessionId: firstSession, engineKey: 'ocr-review', triggerType: 'manual', status: 'failed',
      reportMessageId,
    } }).then((run) => chat.acceptChatTurn({ sessionId: firstSession, runId: run.id, userMessage: message(randomUUID(), '根据本次运行解释') })
      .then((turn) => {
        expect(turn.run?.id).toBe(run.id);
        expect(turn.run?.headSha).toBeNull();
        expect(turn.run?.status).toBe('failed');
        return expect(chat.acceptChatTurn({ sessionId: secondSession, runId: run.id, userMessage: message(randomUUID(), '其他会话') })).rejects.toMatchObject({ status: 404 });
      }));
  }));

  it.each(['queued', 'running', 'cancelling'])('忙碌状态 %s 阻止删除和对话', (status) => prisma.session.update({ where: { id: secondSession }, data: { status } })
    .then(() => Promise.all([
      expect(services.deleteSession(secondSession)).rejects.toMatchObject({ status: 409 }),
      expect(chat.acceptChatTurn({ sessionId: secondSession, userMessage: message(randomUUID(), '提问') })).rejects.toMatchObject({ status: 409 }),
    ])).then(() => undefined));

  it('会话详情返回运行记录，删除非忙碌会话使用真实路由', () => Promise.resolve(app.request(`/sessions/${firstSession}`))
    .then((response) => {
      expect(response.status).toBe(200);
      return response.json() as Promise<Awaited<ReturnType<typeof services.loadSessionDetail>>>;
    }).then((detail) => {
      expect(Object.keys(detail).sort()).toEqual(['session', 'messages', 'messageTree', 'activeLeafMessageId', 'activePathIds', 'runs'].sort());
      expect(detail.runs).toHaveLength(1);
      return prisma.session.update({ where: { id: secondSession }, data: { status: 'completed' } });
    }).then(() => app.request(`/sessions/${secondSession}`, { method: 'DELETE' }))
    .then((response) => {
      expect(response.status).toBe(200);
      return services.sessionExists(secondSession);
    }).then((exists) => expect(exists).toBe(false)));
});

describe('历史钉钉消息只读兼容', () => {
  it('旧会话私聊 API 返回 410，读取历史仍可用，不产生发送记录', async () => {
    const response = await app.request(`/sessions/${firstSession}/dingtalk-messages`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmed: true, text: '不得发送' }) });
    expect(response.status).toBe(410);
    const history = await app.request(`/sessions/${firstSession}/dingtalk-messages`);
    expect(history.status).toBe(200);
    expect(await history.json()).toEqual({ messages: [] });
    expect(await prisma.dingtalkMessage.count()).toBe(0);
  });

  it('旧草稿不能用于私聊写入，确认字段也无法恢复此能力', () => {
    const draft = { connectionId: 'retired-connection', contactIds: ['retired-contact'], targetKind: 'direct', title: '审查跟进', text: '请核对报告' };
    return expect(dingtalkMessages.sendSessionDingtalkMessage(firstSession, 'tester', { ...draft, requestId: randomUUID(), confirmed: true })).rejects.toMatchObject({ status: 410 });
  });

  it('旧发送记录仍可读取，不返回机器人凭据或恢复草稿工具', () => prisma.dingtalkRobot.create({ data: {
    name: '历史 CLI', transport: 'cli', cliSingleton: true, enabled: false, cliProfile: 'corp:user', secret: 'private-secret',
  } }).then((connection) => prisma.dingtalkMessage.create({ data: {
    id: randomUUID(), sessionId: firstSession, connectionId: connection.id, requestedBy: 'tester', payloadHash: 'historical',
    targetKind: 'direct', recipients: [{ userId: 'old-user', name: '历史收件人' }], title: '历史消息', text: '历史正文', status: 'accepted', remoteIds: ['historical-receipt'],
  } })).then((record) => Promise.resolve(app.request(`/sessions/${firstSession}/dingtalk-messages`)).then(async (response) => {
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ messages: [expect.objectContaining({ id: record.id, title: '历史消息', status: 'accepted', remoteIds: ['historical-receipt'] })] });
    expect(JSON.stringify(body)).not.toContain('private-secret');
  })));
});

describe('Pi 追问的完整 Service 与持久化流程', () => {
  it.each([false, true])('继续对话仅保留只读工具，SSE 和数据库一致，是否关联运行：%s', async (withRun) => {
    let waiting = false;
    let requestCount = 0;
    const requests: Array<{ tools?: Array<{ function: { name: string } }> }> = [];
    let requestStarted: () => void;
    const requested = new Promise<void>((resolve) => { requestStarted = resolve; });
    const server = createModelServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        requests.push(JSON.parse(body));
        requestCount += 1;
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.flushHeaders();
        if (waiting) { requestStarted(); return; }
        const chunk = (delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({ id: `service-${requestCount}`, object: 'chat.completion.chunk',
          model: 'service-test', created: 1, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
        response.end(chunk({ role: 'assistant' }) + chunk({ content: '继续对话仅解释报告，群通知由审查发布流程处理。' })
          + chunk({}, 'stop') + 'data: [DONE]\n\n');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('未取得模型端口');
      const model = await prisma.aIModel.create({ data: { provider: 'openai-compatible', modelId: 'service-test', apiKey: 'test-service-key',
        apiBaseUrl: `http://127.0.0.1:${address.port}/v1`, maxSteps: 8 } });
      const session = await services.createChatSession({});
      const run = withRun ? await prisma.run.create({ data: { sessionId: session.id, engineKey: 'ocr', status: 'failed', error: '提交范围解析失败' } }) : null;
      const messageCount = await prisma.dingtalkMessage.count();
      const response = await chat.prepareChatStream({ sessionId: session.id, aiModelId: model.id, ...(run ? { runId: run.id } : {}),
        messages: [message(randomUUID(), '请私聊名单中的启用人员，请核对报告')] });
      const sse = await response.text();
      expect(requestCount).toBe(1);
      expect((requests[0].tools ?? []).map((tool) => tool.function.name)).toEqual(withRun ? ['review_run_context'] : []);
      expect(sse).toContain('群通知由审查发布流程处理');
      expect(sse).not.toContain('private-');
      const tree = await store.loadSessionMessageTree(session.id);
      expect(tree.messages).toHaveLength(2);
      expect(tree.messages[1].parts).toContainEqual(expect.objectContaining({ type: 'text', text: '继续对话仅解释报告，群通知由审查发布流程处理。' }));
      expect(await prisma.dingtalkMessage.count()).toBe(messageCount);
      const runtime = await import('@server/platform/chat/chat-runtime');
      expect(runtime.isChatSessionActive(session.id)).toBe(false);

      waiting = true;
      const next = await chat.prepareChatStream({ sessionId: session.id, aiModelId: model.id, messages: [message(randomUUID(), '再解释一下')] });
      const output = next.text();
      await requested;
      await runtime.stopChatSession(session.id);
      expect(await output).toContain('"type":"abort"');
      expect(runtime.isChatSessionActive(session.id)).toBe(false);
      expect(requestCount).toBe(2);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
