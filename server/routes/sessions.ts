import { Hono } from 'hono';
import { prisma } from '../lib/prisma';
import { getSessionWithRepository, listSessions, loadMessages } from '../lib/chat-store';
import { publishSessionListChanged, subscribeSessionEvents, subscribeSessionListEvents } from '../lib/session-events';

export const sessionRoutes = new Hono();

/** 会话列表（侧栏）。?kind=review|chat 过滤。 */
sessionRoutes.get('/', async (c) => {
  const kind = c.req.query('kind');
  return c.json({ sessions: await listSessions(kind) });
});

/** 会话列表事件：新会话、删除、审查状态变化后通知侧栏刷新。 */
sessionRoutes.get('/events', (c) => {
  return new Response(subscribeSessionListEvents(c.req.raw.signal), {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
});

/** 会话实时事件：后台审查流式消息会通过这里推给已打开页面。 */
sessionRoutes.get('/:id/events', async (c) => {
  const id = c.req.param('id');
  const session = await getSessionWithRepository(id);
  if (!session) return c.json({ error: '会话不存在' }, 404);

  return new Response(subscribeSessionEvents(id, c.req.raw.signal), {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
});

/** 会话详情 + 消息。 */
sessionRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const session = await getSessionWithRepository(id);
  if (!session) return c.json({ error: '会话不存在' }, 404);
  const messages = await loadMessages(id);
  return c.json({
    session: {
      id: session.id,
      kind: session.kind,
      title: session.title,
      status: session.status,
      mrIid: session.mrIid,
      mrTitle: session.mrTitle,
      sourceBranch: session.sourceBranch,
      targetBranch: session.targetBranch,
      commitSha: session.commitSha,
      author: session.author,
      error: session.error,
      updatedAt: session.updatedAt,
      repository: session.repository
        ? { id: session.repository.id, name: session.repository.name, path: session.repository.path }
        : null,
    },
    messages,
  });
});

/** 新建普通对话会话（可选绑定仓库以便用其模型配置）。 */
sessionRoutes.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const repositoryId = typeof body.repositoryId === 'string' ? body.repositoryId : null;
  const session = await prisma.session.create({
    data: {
      kind: 'chat',
      title: typeof body.title === 'string' ? body.title : null,
      repositoryId,
      status: 'completed',
    },
  });
  publishSessionListChanged();
  return c.json({ session });
});

/** 删除会话。 */
sessionRoutes.delete('/:id', async (c) => {
  await prisma.session.delete({ where: { id: c.req.param('id') } }).catch(() => undefined);
  publishSessionListChanged();
  return c.json({ success: true });
});
