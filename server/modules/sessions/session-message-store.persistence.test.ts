import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createServer as createModelServer } from 'node:http';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import EmbeddedPostgres from 'embedded-postgres';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { UIMessage } from 'ai';

const executeFile = promisify(execFile);
const directory = resolve('temp', `sessions-validation-${randomUUID()}`);
const originalEnv = { DATABASE_URL: process.env.DATABASE_URL, TMPDIR: process.env.TMPDIR,
  DINGTALK_WORKER_URL: process.env.DINGTALK_WORKER_URL, DINGTALK_WORKER_TOKEN: process.env.DINGTALK_WORKER_TOKEN };
let dwsServer: ReturnType<typeof serve>;
let postgres: EmbeddedPostgres;
let prisma: typeof import('@server/infrastructure/prisma/prisma.service').prisma;
let store: typeof import('./session-message-store.service');
let services: typeof import('./sessions.service');
let chat: typeof import('../chat/chat.service');
let dingtalkTools: ReturnType<typeof import('@server/platform/chat/dingtalk-tools').createDingtalkTools>;
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
  import('@server/platform/chat/dingtalk-tools'), import('../notifications/dingtalk-messages.service'),
  import('@server/platform/dingtalk/cli-worker'),
])).then(([database, messageStore, sessionServices, chatServices, routes, tools, messages, worker]) => {
  prisma = database.prisma;
  store = messageStore;
  services = sessionServices;
  chat = chatServices;
  dingtalkTools = tools.createDingtalkTools();
  dingtalkMessages = messages;
  app = new Hono().route('/sessions', routes.sessionRoutes);
  process.env.DINGTALK_WORKER_TOKEN = randomUUID();
  const workerApp = worker.createDingtalkWorker(process.env.DINGTALK_WORKER_TOKEN, (input) => Promise.resolve(input.action === 'auth-status'
    ? { authenticated: true, tokenValid: true, profile: 'corp:user', userName: '测试登录人', corpName: '测试组织', reason: null }
    : input.action === 'search' ? { people: [{ userId: 'real-user', name: '启用人员', employeeNo: '251111' }], returnedCount: 1 }
      : { status: 'accepted', remoteIds: ['test-receipt'] }));
  return new Promise<void>((resolve) => {
    dwsServer = serve({ fetch: workerApp.fetch, port: 0, hostname: '127.0.0.1' }, (address) => {
      process.env.DINGTALK_WORKER_URL = `http://127.0.0.1:${address.port}`; resolve();
    });
  }).then(() => Promise.all([services.createChatSession({}), services.createChatSession({})]));
}).then(([first, second]) => { firstSession = first.id; secondSession = second.id; }), 60_000);

afterAll(() => Promise.resolve().then(() => prisma?.$disconnect()).finally(() => postgres?.stop()).finally(() => {
  dwsServer?.close();
  for (const name of ['DATABASE_URL', 'TMPDIR', 'DINGTALK_WORKER_URL', 'DINGTALK_WORKER_TOKEN'] as const) {
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

describe('Pi 钉钉工具使用真实平台配置和名单', () => {
  let connectionId: string;
  let contactId: string;
  let foreignContactId: string;
  const execute = (name: string, input: Record<string, unknown>) => {
    const tool = dingtalkTools.find((item) => item.name === name);
    if (!tool) throw new Error(`未注册工具 ${name}`);
    return tool.execute('dingtalk-test', input as never, undefined, undefined, {} as never);
  };

  it('连接与名单只暴露启用数据，不向 Pi 返回机器人凭据', () => prisma.dingtalkRobot.create({ data: {
    name: 'Pi 连接', transport: 'cli', cliSingleton: true, enabled: true, cliProfile: 'corp:user', secret: 'private-secret',
  } }).then((connection) => {
    connectionId = connection.id;
    return Promise.all([
      prisma.dingtalkContact.create({ data: { connectionId, cliProfile: 'corp:user', userId: 'real-user', name: '启用人员', employeeNo: '251111' } }),
      prisma.dingtalkContact.create({ data: { connectionId, cliProfile: 'corp:user', userId: 'disabled-user', name: '停用人员', enabled: false } }),
      prisma.dingtalkRobot.create({ data: { name: '停用 Webhook', enabled: false } }),
      prisma.dingtalkRobot.create({ data: { name: '未配置 Webhook', enabled: true } }),
    ]);
  }).then(([contact, _disabled, other]) => {
    contactId = contact.id;
    return prisma.dingtalkContact.create({ data: { connectionId: other.id, userId: 'foreign-user', name: '其他连接人员' } });
  }).then((contact) => { foreignContactId = contact.id; return execute('dingtalk_connections', {}); }).then((result) => {
    expect(result.details).toEqual([{ id: connectionId, name: 'Pi 连接', cliProfile: 'corp:user', cliGroupId: null }]);
    expect(JSON.stringify(result)).not.toContain('private-');
    return execute('dingtalk_contacts', { connectionId });
  }).then((result) => expect(result.details).toEqual([{ id: contactId, userId: 'real-user', name: '启用人员', employeeNo: '251111' }])));

  it('只生成待确认草稿，不发消息、不写发送记录，并拒绝伪造或跨连接收件人', () => {
    const draft = { connectionId, contactIds: [contactId], targetKind: 'direct', title: '审查跟进', text: '请核对报告' };
    return execute('dingtalk_message_draft', draft).then((result) => {
      expect(result.details).toMatchObject({ requiresConfirmation: true, draft: { ...draft, profile: 'corp:user' }, recipients: [{ name: '启用人员', employeeNo: '251111' }] });
      expect(JSON.stringify(result)).not.toContain('private-');
      return Promise.all([
        expect(execute('dingtalk_message_draft', { ...draft, contactIds: ['251111'] })).rejects.toMatchObject({ status: 400 }),
        expect(execute('dingtalk_message_draft', { ...draft, contactIds: [foreignContactId] })).rejects.toMatchObject({ status: 400 }),
        expect(execute('dingtalk_message_draft', { ...draft, contactIds: [] })).rejects.toMatchObject({ status: 400 }),
        prisma.dingtalkMessage.count(),
      ]);
    }).then((results) => expect(results.at(-1)).toBe(0));
  });

  it('模型不能伪造确认字段，实际发送仍要求确认', () => {
    const draft = { connectionId, contactIds: [contactId], targetKind: 'direct', title: '审查跟进', text: '请核对报告' };
    expect(() => dingtalkMessages.sendSessionDingtalkMessage(firstSession, 'tester', { ...draft, requestId: randomUUID() })).toThrow();
    return expect(execute('dingtalk_message_draft', { ...draft, confirmed: true })).rejects.toThrow();
  });
});

describe('Pi 追问的完整 Service 与持久化流程', () => {
  it('通过配置模型生成钉钉草稿，SSE 和数据库一致，停止后释放聊天资格', async () => {
    const connection = await prisma.dingtalkRobot.findFirstOrThrow({ where: { name: 'Pi 连接' } });
    const contact = await prisma.dingtalkContact.findFirstOrThrow({ where: { connectionId: connection.id, enabled: true } });
    const draft = { connectionId: connection.id, contactIds: [contact.id], targetKind: 'direct', title: '审查跟进', text: '请核对报告' };
    let waiting = false;
    let requestCount = 0;
    let requestStarted: () => void;
    const requested = new Promise<void>((resolve) => { requestStarted = resolve; });
    const server = createModelServer((request, response) => {
      request.resume();
      request.on('end', () => {
        requestCount += 1;
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.flushHeaders();
        if (waiting) { requestStarted(); return; }
        const tool = requestCount === 1 ? { name: 'dingtalk_connections', arguments: '{}' }
          : requestCount === 2 ? { name: 'dingtalk_contacts', arguments: JSON.stringify({ connectionId: connection.id }) }
            : requestCount === 3 ? { name: 'dingtalk_message_draft', arguments: JSON.stringify(draft) } : null;
        const chunk = (delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({ id: `service-${requestCount}`, object: 'chat.completion.chunk',
          model: 'service-test', created: 1, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
        response.end(chunk({ role: 'assistant' }) + (tool
          ? chunk({ tool_calls: [{ index: 0, id: `call-${requestCount}`, type: 'function', function: tool }] })
          : chunk({ content: '消息草稿已准备好，尚未发送，请在平台确认。' }))
          + chunk({}, tool ? 'tool_calls' : 'stop') + 'data: [DONE]\n\n');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('未取得模型端口');
      const model = await prisma.aIModel.create({ data: { provider: 'openai-compatible', modelId: 'service-test', apiKey: 'test-service-key',
        apiBaseUrl: `http://127.0.0.1:${address.port}/v1`, maxSteps: 8 } });
      const session = await services.createChatSession({});
      const response = await chat.prepareChatStream({ sessionId: session.id, aiModelId: model.id, messages: [message(randomUUID(), '请私聊名单中的启用人员，请核对报告')] });
      const sse = await response.text();
      expect(requestCount).toBe(4);
      expect(sse).toContain('dingtalk_message_draft');
      expect(sse).toContain('requiresConfirmation');
      expect(sse).not.toContain('private-');
      const tree = await store.loadSessionMessageTree(session.id);
      expect(tree.messages).toHaveLength(2);
      expect(tree.messages[1].parts).toContainEqual(expect.objectContaining({ type: 'dynamic-tool', toolName: 'dingtalk_message_draft',
        state: 'output-available', output: expect.objectContaining({ requiresConfirmation: true, draft: { ...draft, profile: 'corp:user' } }) }));
      expect(await prisma.dingtalkMessage.count()).toBe(0);
      const runtime = await import('@server/platform/chat/chat-runtime');
      expect(runtime.isChatSessionActive(session.id)).toBe(false);

      waiting = true;
      const next = await chat.prepareChatStream({ sessionId: session.id, aiModelId: model.id, messages: [message(randomUUID(), '再解释一下')] });
      const output = next.text();
      await requested;
      await runtime.stopChatSession(session.id);
      expect(await output).toContain('"type":"abort"');
      expect(runtime.isChatSessionActive(session.id)).toBe(false);
      expect(requestCount).toBe(5);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
