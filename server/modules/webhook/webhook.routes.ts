import { Hono } from "hono";

import { handleGitLabWebhook } from "./webhook.service";

export const webhookRoutes = new Hono();

webhookRoutes.post("/gitlab", (context) => context.req.json().then((body) => handleGitLabWebhook({
  event: context.req.header("X-Gitlab-Event"), token: context.req.header("X-Gitlab-Token"), body,
})).then((result) => context.json(result.body, result.status)));
