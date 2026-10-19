-- 保留平台配置，清除审查历史，建立独立执行记录与登录会话。
ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_activeLeafMessageId_fkey";
TRUNCATE TABLE "review_runs", "messages", "sessions";
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_activeLeafMessageId_fkey" FOREIGN KEY ("activeLeafMessageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
DROP TABLE "review_runs";
DROP TABLE "repository_tool_settings", "repository_skill_settings", "agent_tools", "agent_skills";
ALTER TABLE "repositories" DROP COLUMN "memory";
ALTER TABLE "sessions" ALTER COLUMN "status" SET DEFAULT $$completed$$;
ALTER TABLE "repositories" ADD COLUMN "ocrConcurrency" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "ocrTimeoutMinutes" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "ocrMaxTokensBudget" INTEGER NOT NULL DEFAULT 200000;
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_ocr_limits" CHECK ("ocrConcurrency" BETWEEN 1 AND 16 AND "ocrTimeoutMinutes" BETWEEN 1 AND 120 AND "ocrMaxTokensBudget" > 0);
CREATE TABLE "runs" (
  "id" TEXT PRIMARY KEY,
  "sessionId" TEXT NOT NULL REFERENCES "sessions"("id") ON DELETE CASCADE,
  "repositoryId" TEXT REFERENCES "repositories"("id") ON DELETE SET NULL,
  "engineKey" TEXT NOT NULL,
  "engineVersion" TEXT,
  "engineSessionId" TEXT,
  "triggerType" TEXT NOT NULL DEFAULT $$manual$$,
  "eventKey" TEXT UNIQUE,
  "status" TEXT NOT NULL DEFAULT $$queued$$,
  "baseSha" TEXT,
  "startSha" TEXT,
  "headSha" TEXT,
  "provider" TEXT,
  "modelId" TEXT,
  "traceId" TEXT,
  "input" JSONB,
  "inputMessageId" TEXT,
  "reportMessageId" TEXT UNIQUE,
  "exitCode" INTEGER,
  "rawResult" JSONB,
  "deliveries" JSONB NOT NULL DEFAULT $${}$$,
  "error" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "runs_sessionId_createdAt_idx" ON "runs"("sessionId", "createdAt");
CREATE INDEX "runs_repositoryId_createdAt_idx" ON "runs"("repositoryId", "createdAt");
CREATE INDEX "runs_status_createdAt_idx" ON "runs"("status", "createdAt");
CREATE UNIQUE INDEX "runs_active_session" ON "runs"("sessionId") WHERE "status" IN ($$queued$$, $$running$$, $$cancelling$$);
CREATE TABLE "auth_sessions" (
  "id" TEXT PRIMARY KEY,
  "tokenHash" TEXT NOT NULL UNIQUE,
  "username" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "auth_sessions_expiresAt_idx" ON "auth_sessions"("expiresAt");
