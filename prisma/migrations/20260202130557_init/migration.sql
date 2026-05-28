-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

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
CREATE TABLE "ai_models" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "apiEndpoint" TEXT,
    "maxTokens" INTEGER,
    "temperature" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repositories" (
    "id" TEXT NOT NULL,
    "gitLabProjectId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "description" TEXT,
    "gitLabAccountId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "autoReview" BOOLEAN NOT NULL DEFAULT false,
    "defaultAIModelId" TEXT,
    "watchBranches" TEXT,
    "customPrompt" TEXT,
    "customPromptMode" TEXT DEFAULT 'extend',
    "customProvider" TEXT,
    "customModelId" TEXT,
    "customApiKey" TEXT,
    "customApiEndpoint" TEXT,
    "customMaxTokens" INTEGER,
    "customTemperature" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_logs" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "mergeRequestId" INTEGER NOT NULL,
    "mergeRequestIid" INTEGER NOT NULL,
    "sourceBranch" TEXT NOT NULL,
    "targetBranch" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "authorUsername" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "commitSha" TEXT NOT NULL,
    "commitShortId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "totalFiles" INTEGER NOT NULL,
    "reviewedFiles" INTEGER NOT NULL DEFAULT 0,
    "criticalIssues" INTEGER NOT NULL DEFAULT 0,
    "normalIssues" INTEGER NOT NULL DEFAULT 0,
    "suggestions" INTEGER NOT NULL DEFAULT 0,
    "aiSummary" TEXT,
    "aiResponse" TEXT,
    "reviewPrompts" TEXT,
    "aiModelProvider" TEXT,
    "aiModelId" TEXT,
    "gitlabDiscussionId" TEXT,
    "gitlabNoteId" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "review_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_comments" (
    "id" TEXT NOT NULL,
    "reviewLogId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "lineRangeEnd" INTEGER,
    "severity" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "diffHunk" TEXT,
    "confidence" DOUBLE PRECISION,
    "gitlabCommentId" TEXT,
    "isPosted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "dingtalkWebhookUrl" TEXT,
    "dingtalkSecret" TEXT,
    "dingtalkEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repository_memory_snapshots" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "architectureSummary" TEXT NOT NULL,
    "memoryJson" JSONB,
    "entrypointsJson" JSONB,
    "layersJson" JSONB,
    "conventionsJson" JSONB,
    "risksJson" JSONB,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "lastIndexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repository_memory_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_file_nodes" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "importsJson" JSONB,
    "exportsJson" JSONB,
    "lastIndexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "code_file_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_symbol_nodes" (
    "id" TEXT NOT NULL,
    "fileNodeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "signature" TEXT,
    "startLine" INTEGER NOT NULL,
    "endLine" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "code_symbol_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_relation_edges" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "fromFileNodeId" TEXT NOT NULL,
    "fromSymbolNodeId" TEXT,
    "toFileNodeId" TEXT,
    "toSymbolNodeId" TEXT,
    "relationType" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "evidence" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "code_relation_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repository_memory_facts" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" TEXT NOT NULL,
    "lastVerifiedCommit" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repository_memory_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_agent_traces" (
    "id" TEXT NOT NULL,
    "reviewLogId" TEXT NOT NULL,
    "memorySnapshotId" TEXT,
    "loopIterationsJson" JSONB,
    "retrievedContextJson" JSONB,
    "finalPlanJson" JSONB,
    "criticJson" JSONB,
    "memoryUpdatesJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_agent_traces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repositories_gitLabProjectId_gitLabAccountId_key" ON "repositories"("gitLabProjectId", "gitLabAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "review_logs_repositoryId_mergeRequestIid_commitSha_key" ON "review_logs"("repositoryId", "mergeRequestIid", "commitSha");

-- CreateIndex
CREATE UNIQUE INDEX "notification_settings_scope_key" ON "notification_settings"("scope");

-- CreateIndex
CREATE INDEX "repository_memory_snapshots_repositoryId_branch_status_idx" ON "repository_memory_snapshots"("repositoryId", "branch", "status");

-- CreateIndex
CREATE UNIQUE INDEX "repository_memory_snapshots_repositoryId_branch_commitSha_key" ON "repository_memory_snapshots"("repositoryId", "branch", "commitSha");

-- CreateIndex
CREATE INDEX "code_file_nodes_repositoryId_branch_role_idx" ON "code_file_nodes"("repositoryId", "branch", "role");

-- CreateIndex
CREATE UNIQUE INDEX "code_file_nodes_repositoryId_branch_commitSha_filePath_key" ON "code_file_nodes"("repositoryId", "branch", "commitSha", "filePath");

-- CreateIndex
CREATE INDEX "code_file_nodes_repositoryId_branch_commitSha_idx" ON "code_file_nodes"("repositoryId", "branch", "commitSha");

-- CreateIndex
CREATE INDEX "code_symbol_nodes_fileNodeId_kind_idx" ON "code_symbol_nodes"("fileNodeId", "kind");

-- CreateIndex
CREATE INDEX "code_symbol_nodes_name_idx" ON "code_symbol_nodes"("name");

-- CreateIndex
CREATE INDEX "code_relation_edges_repositoryId_branch_fromFileNodeId_idx" ON "code_relation_edges"("repositoryId", "branch", "fromFileNodeId");

-- CreateIndex
CREATE INDEX "code_relation_edges_repositoryId_branch_toFileNodeId_idx" ON "code_relation_edges"("repositoryId", "branch", "toFileNodeId");

-- CreateIndex
CREATE INDEX "code_relation_edges_repositoryId_branch_relationType_idx" ON "code_relation_edges"("repositoryId", "branch", "relationType");

-- CreateIndex
CREATE INDEX "repository_memory_facts_repositoryId_branch_type_idx" ON "repository_memory_facts"("repositoryId", "branch", "type");

-- CreateIndex
CREATE UNIQUE INDEX "repository_memory_facts_repositoryId_branch_type_content_key" ON "repository_memory_facts"("repositoryId", "branch", "type", "content");

-- CreateIndex
CREATE UNIQUE INDEX "review_agent_traces_reviewLogId_key" ON "review_agent_traces"("reviewLogId");

-- CreateIndex
CREATE INDEX "review_agent_traces_memorySnapshotId_idx" ON "review_agent_traces"("memorySnapshotId");

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_gitLabAccountId_fkey" FOREIGN KEY ("gitLabAccountId") REFERENCES "gitlab_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_defaultAIModelId_fkey" FOREIGN KEY ("defaultAIModelId") REFERENCES "ai_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_reviewLogId_fkey" FOREIGN KEY ("reviewLogId") REFERENCES "review_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository_memory_snapshots" ADD CONSTRAINT "repository_memory_snapshots_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_file_nodes" ADD CONSTRAINT "code_file_nodes_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_symbol_nodes" ADD CONSTRAINT "code_symbol_nodes_fileNodeId_fkey" FOREIGN KEY ("fileNodeId") REFERENCES "code_file_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_relation_edges" ADD CONSTRAINT "code_relation_edges_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_relation_edges" ADD CONSTRAINT "code_relation_edges_fromFileNodeId_fkey" FOREIGN KEY ("fromFileNodeId") REFERENCES "code_file_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_relation_edges" ADD CONSTRAINT "code_relation_edges_fromSymbolNodeId_fkey" FOREIGN KEY ("fromSymbolNodeId") REFERENCES "code_symbol_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_relation_edges" ADD CONSTRAINT "code_relation_edges_toFileNodeId_fkey" FOREIGN KEY ("toFileNodeId") REFERENCES "code_file_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_relation_edges" ADD CONSTRAINT "code_relation_edges_toSymbolNodeId_fkey" FOREIGN KEY ("toSymbolNodeId") REFERENCES "code_symbol_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository_memory_facts" ADD CONSTRAINT "repository_memory_facts_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_agent_traces" ADD CONSTRAINT "review_agent_traces_reviewLogId_fkey" FOREIGN KEY ("reviewLogId") REFERENCES "review_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_agent_traces" ADD CONSTRAINT "review_agent_traces_memorySnapshotId_fkey" FOREIGN KEY ("memorySnapshotId") REFERENCES "repository_memory_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
