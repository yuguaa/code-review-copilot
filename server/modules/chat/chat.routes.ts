import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { prepareChatStream } from './chat.service';
import { stopChatSession } from "@server/platform/chat/chat-runtime";

export const chatRoutes = new Hono();
chatRoutes.post("/:id/stop", (context) => stopChatSession(context.req.param("id")).then(() => context.json({ success: true })));

chatRoutes.post('/', (c) => c.req.json()
  .catch(() => { throw new HTTPException(400, { message: '请求体必须为有效 JSON' }); })
  .then(prepareChatStream));
