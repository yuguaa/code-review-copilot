-- CreateTable
CREATE TABLE "repository_sandbox_bindings" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "sandboxId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "image" TEXT NOT NULL,
    "piHostPath" TEXT NOT NULL,
    "piSandboxMountPath" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pausedAt" TIMESTAMP(3),
    "error" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repository_sandbox_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repository_sandbox_bindings_repositoryId_key" ON "repository_sandbox_bindings"("repositoryId");

-- CreateIndex
CREATE UNIQUE INDEX "repository_sandbox_bindings_sandboxId_key" ON "repository_sandbox_bindings"("sandboxId");

-- CreateIndex
CREATE INDEX "repository_sandbox_bindings_repositoryId_status_idx" ON "repository_sandbox_bindings"("repositoryId", "status");

-- CreateIndex
CREATE INDEX "repository_sandbox_bindings_status_lastUsedAt_idx" ON "repository_sandbox_bindings"("status", "lastUsedAt");

-- AddForeignKey
ALTER TABLE "repository_sandbox_bindings" ADD CONSTRAINT "repository_sandbox_bindings_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "review_sandbox_sessions" (
    "id" TEXT NOT NULL,
    "reviewLogId" TEXT NOT NULL,
    "repositorySandboxBindingId" TEXT NOT NULL,
    "sandboxId" TEXT NOT NULL,
    "piSessionId" TEXT,
    "worktreePath" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_sandbox_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "review_sandbox_sessions_reviewLogId_key" ON "review_sandbox_sessions"("reviewLogId");

-- CreateIndex
CREATE INDEX "review_sandbox_sessions_repositorySandboxBindingId_status_idx" ON "review_sandbox_sessions"("repositorySandboxBindingId", "status");

-- CreateIndex
CREATE INDEX "review_sandbox_sessions_sandboxId_status_idx" ON "review_sandbox_sessions"("sandboxId", "status");

-- AddForeignKey
ALTER TABLE "review_sandbox_sessions" ADD CONSTRAINT "review_sandbox_sessions_reviewLogId_fkey" FOREIGN KEY ("reviewLogId") REFERENCES "review_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_sandbox_sessions" ADD CONSTRAINT "review_sandbox_sessions_repositorySandboxBindingId_fkey" FOREIGN KEY ("repositorySandboxBindingId") REFERENCES "repository_sandbox_bindings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
