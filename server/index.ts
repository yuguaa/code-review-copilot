import "dotenv/config";
import { serve } from "@hono/node-server";

import { createApp } from "./app";
import { appConfig } from "./config/app.config";
import { getMissingAuthEnv } from "./config/auth.config";
import { prisma } from "./infrastructure/prisma/prisma.service";
import { startRssScheduler, stopRssScheduler } from "./modules/rss/rss.scheduler";
import { startSecurityScheduler, stopSecurityScheduler } from "./modules/security/security-scheduler";
import { stopChatSessions } from "./platform/chat/chat-runtime";
import { startRunWorker, stopRunWorker } from "./platform/runs/run-service";
import { startTelemetry, stopTelemetry } from "./platform/telemetry/telemetry.service";

let server: ReturnType<typeof serve> | undefined;
let closing = false;

function shutdown(exitCode: number): void {
  if (closing) return;
  closing = true;
  server?.close();
  Promise.allSettled([stopRunWorker(), stopRssScheduler(), stopSecurityScheduler(), stopChatSessions()])
    .then((results) => Promise.allSettled([stopTelemetry(), prisma.$disconnect()]).then((cleanup) => {
      process.exit(results.concat(cleanup).some((result) => result.status === "rejected") ? 1 : exitCode);
    }));
}

const missing = getMissingAuthEnv();
const startup = missing.length ? Promise.reject(new Error(`认证配置缺失：${missing.join(", ")}`)) : startTelemetry();
startup.then(() => startRunWorker(() => shutdown(1))).then(() => {
  if (closing) return;
  server = serve({ fetch: createApp().fetch, port: appConfig.port });
  startRssScheduler();
  startSecurityScheduler();
  console.info(`平台服务已启动，端口 ${appConfig.port}`);
  process.once("SIGTERM", () => shutdown(0));
  process.once("SIGINT", () => shutdown(0));
}).catch((error: unknown) => {
  console.error("平台启动失败", error instanceof Error ? error.message : "未知错误");
  shutdown(1);
});
