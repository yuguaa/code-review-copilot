import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import { listDingtalkMessages } from '@server/modules/notifications/dingtalk-messages.service';

import { subscribeSessionEvents, subscribeSessionListEvents } from './session-events.service';
import { createChatSession, deleteSession, listSessionSummaries, loadSessionDetail, runReviewCommand, sessionExists, stopReviewSession, switchActiveMessage } from './sessions.service';

export const sessionRoutes = new Hono();

const eventHeaders = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};
const createSessionSchema = z.object({
  repositoryId: z.string().trim().min(1).max(200).nullable().optional(),
  title: z.string().trim().max(200).optional(),
}).strict();
const activeMessageSchema = z.object({ messageId: z.string().min(1).max(200) }).strict();

sessionRoutes.get('/', (c) => listSessionSummaries(c.req.query('kind')).then((sessions) => c.json({ sessions })));
sessionRoutes.get('/events', (c) => new Response(subscribeSessionListEvents(c.req.raw.signal), { headers: eventHeaders }));
sessionRoutes.get('/:id/events', (c) => sessionExists(c.req.param('id')).then((exists) => {
  if (!exists) throw new HTTPException(404, { message: '会话不存在' });
  return new Response(subscribeSessionEvents(c.req.param('id'), c.req.raw.signal), { headers: eventHeaders });
}));
sessionRoutes.get('/:id', (c) => loadSessionDetail(c.req.param('id')).then((detail) => c.json(detail)));
sessionRoutes.get('/:id/dingtalk-messages', (c) => listDingtalkMessages(c.req.param('id')).then((messages) => c.json({ messages })));
sessionRoutes.post('/:id/dingtalk-messages', () => {
  throw new HTTPException(410, { message: '继续对话中的钉钉私聊已停用，请使用审查报告的机器人群通知' });
});
sessionRoutes.post('/:id/active-message', (c) => readBody(c.req.raw, activeMessageSchema)
  .then((body) => switchActiveMessage(c.req.param('id'), body.messageId))
  .then((tree) => c.json(tree)));
sessionRoutes.post('/:id/review-command', (c) => runReviewCommand(c.req.param('id')).then((tree) => c.json(tree)));
sessionRoutes.post('/:id/stop-review', (c) => stopReviewSession(c.req.param('id')).then((result) => c.json(result)));
sessionRoutes.post('/', (c) => readBody(c.req.raw, createSessionSchema)
  .then(createChatSession)
  .then((session) => c.json({ session }, 201)));
sessionRoutes.delete('/:id', (c) => deleteSession(c.req.param('id')).then((result) => c.json(result)));

function readBody<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.infer<T>> {
  return request.json().catch(() => { throw new HTTPException(400, { message: '请求体必须为有效 JSON' }); })
    .then((body) => {
      const parsed = schema.safeParse(body);
      if (!parsed.success) throw new HTTPException(400, { message: parsed.error.issues[0].message });
      return parsed.data;
    });
}
