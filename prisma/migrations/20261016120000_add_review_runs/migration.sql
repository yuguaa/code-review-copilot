CREATE TABLE "review_runs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "repositoryId" TEXT,
    "engineKey" TEXT NOT NULL,
    "engineVersion" TEXT,
    "engineSessionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "rawResult" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "review_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "review_runs_sessionId_createdAt_idx" ON "review_runs"("sessionId", "createdAt");
CREATE INDEX "review_runs_repositoryId_createdAt_idx" ON "review_runs"("repositoryId", "createdAt");

ALTER TABLE "review_runs" ADD CONSTRAINT "review_runs_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "review_runs" ADD CONSTRAINT "review_runs_repositoryId_fkey"
    FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
