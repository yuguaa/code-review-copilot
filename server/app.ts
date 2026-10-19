import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { requireAuth } from "./common/guards/auth.guard";
import { appConfig } from "./config/app.config";
import { authRoutes } from "./modules/auth/auth.routes";
import { chatRoutes } from "./modules/chat/chat.routes";
import { repositoryRoutes } from "./modules/repositories/repositories.routes";
import { rssRoutes } from "./modules/rss/rss.routes";
import { securityRoutes } from "./modules/security/security.routes";
import { sessionRoutes } from "./modules/sessions/sessions.routes";
import { settingsRoutes } from "./modules/settings/settings.routes";
import { webhookRoutes } from "./modules/webhook/webhook.routes";
import { runRoutes } from "./platform/runs/run-routes";
import { observabilityRoutes } from "./platform/telemetry/observability.routes";

export function createApp() {
  const app = new Hono();
  app.get("/healthz", (context) => context.text("ok"));
  /* 浏览器写请求限制同源，Webhook 使用自己的凭证校验。 */
  app.use("*", (context, next) => {
    const origin = context.req.header("origin");
    if (origin && !["GET", "HEAD", "OPTIONS"].includes(context.req.method) && !context.req.path.startsWith("/api/webhook/")) {
      const expected = process.env.APP_PUBLIC_URL ? new URL(process.env.APP_PUBLIC_URL).origin : new URL(context.req.url).origin;
      if (origin !== expected && !(appConfig.isDevelopment && new URL(origin).hostname === "localhost")) throw new HTTPException(403, { message: "请求来源无效" });
    }
    return next();
  });
  app.use("/api/*", requireAuth);
  app.route("/api/auth", authRoutes);
  app.route("/api/sessions", sessionRoutes);
  app.route("/api/runs", runRoutes);
  app.route("/api/repositories", repositoryRoutes);
  app.route("/api/settings", settingsRoutes);
  app.route("/api/chat", chatRoutes);
  app.route("/api/webhook", webhookRoutes);
  app.route("/api/rss", rssRoutes);
  app.route("/api/security", securityRoutes);
  app.route("/observability", observabilityRoutes);
  app.onError((error, context) => {
    if (error instanceof HTTPException) return context.json({ error: error.message }, error.status);
    if (error instanceof ZodError) return context.json({ error: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("；") }, 400);
    if (error instanceof SyntaxError) return context.json({ error: "请求 JSON 格式无效" }, 400);
    if ((error as { code?: string }).code === "P2002") return context.json({ error: "记录已经存在或任务正在执行" }, 409);
    if ((error as { code?: string }).code === "P2025") return context.json({ error: "记录不存在" }, 404);
    console.error("请求处理失败", error.name);
    return context.json({ error: "请求处理失败，请检查服务运行状态" }, 500);
  });
  app.all("/api/*", (context) => context.json({ error: "接口不存在" }, 404));
  if (appConfig.isProduction) {
    app.use("/*", serveStatic({ root: "./dist/web" }));
    app.get("/*", serveStatic({ path: "./dist/web/index.html" }));
  }
  return app;
}
