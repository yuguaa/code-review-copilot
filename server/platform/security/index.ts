import "dotenv/config";

import { prisma } from "@server/infrastructure/prisma/prisma.service";

import { startSecurityWorker, stopSecurityWorker } from "./worker";

let closing = false;

function shutdown(exitCode: number): void {
  if (closing) return;
  closing = true;
  stopSecurityWorker()
    .then(() => prisma.$disconnect())
    .then(() => process.exit(exitCode))
    .catch(() => {
      void prisma.$disconnect();
      process.exit(1);
    });
}

startSecurityWorker(() => shutdown(1)).then(() => {
  if (closing) return;
  console.info("安全测试执行器已经启动");
  process.once("SIGTERM", () => shutdown(0));
  process.once("SIGINT", () => shutdown(0));
}).catch((error: unknown) => {
  console.error("安全测试执行器启动失败", error instanceof Error ? error.message : "未知错误");
  shutdown(1);
});
