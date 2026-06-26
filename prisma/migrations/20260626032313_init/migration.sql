-- CreateTable
CREATE TABLE "gitlab_accounts" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "webhookSecret" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gitlab_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repositories" (
    "id" TEXT NOT NULL,
    "gitLabAccountId" TEXT NOT NULL,
    "gitLabProjectId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "description" TEXT,
    "watchBranches" TEXT,
    "autoReview" BOOLEAN NOT NULL DEFAULT true,
    "modelProvider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "apiBaseUrl" TEXT,
    "maxSteps" INTEGER NOT NULL DEFAULT 16,
    "defaultReviewPrompt" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'review',
    "title" TEXT,
    "repositoryId" TEXT,
    "mrIid" INTEGER,
    "mrTitle" TEXT,
    "sourceBranch" TEXT,
    "targetBranch" TEXT,
    "commitSha" TEXT,
    "author" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "parts" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repositories_gitLabProjectId_gitLabAccountId_key" ON "repositories"("gitLabProjectId", "gitLabAccountId");

-- CreateIndex
CREATE INDEX "sessions_kind_updatedAt_idx" ON "sessions"("kind", "updatedAt");

-- CreateIndex
CREATE INDEX "sessions_repositoryId_idx" ON "sessions"("repositoryId");

-- CreateIndex
CREATE INDEX "messages_sessionId_createdAt_idx" ON "messages"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_gitLabAccountId_fkey" FOREIGN KEY ("gitLabAccountId") REFERENCES "gitlab_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
