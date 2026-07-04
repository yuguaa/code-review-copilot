import { Hono } from 'hono';
import {
  subscribeSessionEvents,
  subscribeSessionListEvents,
} from './session-events.service';
import {
  createChatSession,
  deleteSession,
  listSessionSummaries,
  loadSessionDetail,
  runReviewCommand,
  sessionExists,
  submitMessageFeedback,
  switchActiveMessage,
} from './sessions.service';

export const sessionRoutes = new Hono();

/** 会话列表（侧栏）。?kind=review|chat 过滤。 */
sessionRoutes.get('/', async (c) => {
  const kind = c.req.query('kind');
  return c.json({ sessions: await listSessionSummaries(kind) });
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
  if (!(await sessionExists(id))) return c.json({ error: '会话不存在' }, 404);

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
  const detail = await loadSessionDetail(id);
  if (!detail) return c.json({ error: '会话不存在' }, 404);
  return c.json(detail);
});

/** 切换当前会话 active message，并自动落到该节点子树下最近叶子。 */
sessionRoutes.post('/:id/active-message', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const messageId = typeof body.messageId === 'string' ? body.messageId : null;
  if (!messageId) return c.json({ error: '缺少 messageId' }, 400);

  const tree = await switchActiveMessage(sessionId, messageId);
  if (!tree) return c.json({ error: '消息不存在' }, 404);
  return c.json(tree);
});

/** 用户反馈某条审查发现：写入消息元数据，并沉淀到仓库级长期记忆。 */
sessionRoutes.post('/:id/message-feedback', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const result = await submitMessageFeedback(sessionId, body.messageId, body.feedback, body.findingText);
  if (result.kind === 'missing-message-id') return c.json({ error: '缺少 messageId' }, 400);
  if (result.kind === 'invalid-feedback') return c.json({ error: '反馈类型无效' }, 400);
  if (result.kind === 'missing-message') return c.json({ error: '消息不存在' }, 404);
  if (result.kind === 'missing-repository') return c.json({ error: '当前会话未绑定仓库，无法沉淀长期记忆' }, 400);
  return c.json(result.tree);
});

/** 输入框 Slash Command：重新执行当前审查，并按仓库配置发布评论/钉钉。 */
sessionRoutes.post('/:id/review-command', async (c) => {
  const sessionId = c.req.param('id');
  const result = await runReviewCommand(sessionId);
  if (result.kind === 'missing') return c.json({ error: '会话不存在' }, 404);
  if (result.kind === 'invalid-kind') return c.json({ error: '代码审查指令只能在审查会话中执行' }, 400);
  if (result.kind === 'running') return c.json({ error: '本次审查正在运行中' }, 409);
  if (result.kind === 'missing-seed') {
    return c.json({ error: '会话缺少审查种子消息，无法重新执行 review' }, 400);
  }
  return c.json(result.tree);
});

/** 新建普通对话会话（可选绑定仓库以便用其模型配置）。 */
sessionRoutes.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json({ session: await createChatSession(body) });
});

/** 删除会话。 */
sessionRoutes.delete('/:id', async (c) => {
  return c.json(await deleteSession(c.req.param('id')));
});
