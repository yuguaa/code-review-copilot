import { Hono } from "hono";

import { configurationError } from "../settings/config-input";
import { createRssSubscription, deleteRssSubscription, fetchRssSubscription, listRssSubscriptions, updateRssSubscription } from "./rss.service";

export const rssRoutes = new Hono();

rssRoutes.onError(configurationError);
rssRoutes.get("/subscriptions", (c) => listRssSubscriptions().then((subscriptions) => c.json({ subscriptions })));
rssRoutes.post("/subscriptions", (c) => c.req.json().then(createRssSubscription).then((subscription) => c.json({ subscription })));
rssRoutes.patch("/subscriptions/:id", (c) => c.req.json().then((body) => updateRssSubscription(c.req.param("id"), body))
  .then((subscription) => c.json({ subscription })));
rssRoutes.delete("/subscriptions/:id", (c) => deleteRssSubscription(c.req.param("id")).then(() => c.json({ success: true })));
rssRoutes.post("/subscriptions/:id/fetch", (c) => fetchRssSubscription(c.req.param("id")).then((result) => c.json({ result })));
