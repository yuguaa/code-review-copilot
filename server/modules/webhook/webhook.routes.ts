import { Hono } from 'hono';
import { handleGitLabWebhook, type MergeRequestHook, type PushHook } from './webhook.service';

export const webhookRoutes = new Hono();

webhookRoutes.post('/gitlab', async (c) => {
  let body: MergeRequestHook | PushHook;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: '无效的 webhook 载荷' }, 400);
  }

  const result = await handleGitLabWebhook({
    event: c.req.header('X-Gitlab-Event'),
    token: c.req.header('X-Gitlab-Token'),
    body,
  });
  return c.json(result.body, result.status);
});
