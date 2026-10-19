-- CreateTable
CREATE TABLE "security_targets" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "scopeDomains" JSONB NOT NULL DEFAULT '[]',
    "authorizationOwner" TEXT NOT NULL,
    "authorizationReference" TEXT NOT NULL,
    "authorizedUntil" TIMESTAMP(3) NOT NULL,
    "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "scheduleIntervalMinutes" INTEGER NOT NULL DEFAULT 1440,
    "nextScheduledAt" TIMESTAMP(3),
    "lastScheduledAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "maxDurationMinutes" INTEGER NOT NULL DEFAULT 30,
    "defaultAIModelId" TEXT,
    "dingtalkRobotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "security_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_identities" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "username" TEXT NOT NULL,
    "secretCiphertext" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "security_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_tickets" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "report" TEXT,
    "summary" TEXT,
    "riskScore" INTEGER,
    "modelProvider" TEXT,
    "modelId" TEXT,
    "skillVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "security_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_executions" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "agentSessionId" TEXT,
    "traceId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "rawResult" JSONB,

    CONSTRAINT "security_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_findings" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "executionId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "category" TEXT,
    "severity" TEXT NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "remediation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "security_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_traffic" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "executionId" TEXT,
    "method" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "statusCode" INTEGER,
    "requestHeaders" JSONB,
    "responseHeaders" JSONB,
    "bodyPreview" TEXT,
    "contentHash" TEXT,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_traffic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_artifacts" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "executionId" TEXT,
    "type" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "executionId" TEXT,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "security_targets_repositoryId_idx" ON "security_targets"("repositoryId");

-- CreateIndex
CREATE INDEX "security_targets_defaultAIModelId_idx" ON "security_targets"("defaultAIModelId");

-- CreateIndex
CREATE INDEX "security_targets_dingtalkRobotId_idx" ON "security_targets"("dingtalkRobotId");

-- CreateIndex
CREATE INDEX "security_targets_scheduleEnabled_nextScheduledAt_idx" ON "security_targets"("scheduleEnabled", "nextScheduledAt");

-- CreateIndex
CREATE INDEX "security_identities_targetId_isActive_idx" ON "security_identities"("targetId", "isActive");

-- CreateIndex
CREATE INDEX "security_tickets_targetId_createdAt_idx" ON "security_tickets"("targetId", "createdAt");

-- CreateIndex
CREATE INDEX "security_tickets_status_createdAt_idx" ON "security_tickets"("status", "createdAt");

-- CreateIndex
CREATE INDEX "security_executions_ticketId_startedAt_idx" ON "security_executions"("ticketId", "startedAt");

-- CreateIndex
CREATE INDEX "security_findings_ticketId_severity_idx" ON "security_findings"("ticketId", "severity");

-- CreateIndex
CREATE INDEX "security_findings_executionId_idx" ON "security_findings"("executionId");

-- CreateIndex
CREATE UNIQUE INDEX "security_findings_ticketId_fingerprint_key" ON "security_findings"("ticketId", "fingerprint");

-- CreateIndex
CREATE INDEX "security_traffic_ticketId_createdAt_idx" ON "security_traffic"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "security_traffic_executionId_idx" ON "security_traffic"("executionId");

-- CreateIndex
CREATE INDEX "security_artifacts_ticketId_createdAt_idx" ON "security_artifacts"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "security_artifacts_executionId_idx" ON "security_artifacts"("executionId");

-- CreateIndex
CREATE INDEX "security_events_ticketId_createdAt_idx" ON "security_events"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "security_events_executionId_idx" ON "security_events"("executionId");

-- AddForeignKey
ALTER TABLE "security_targets" ADD CONSTRAINT "security_targets_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_targets" ADD CONSTRAINT "security_targets_defaultAIModelId_fkey" FOREIGN KEY ("defaultAIModelId") REFERENCES "ai_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_targets" ADD CONSTRAINT "security_targets_dingtalkRobotId_fkey" FOREIGN KEY ("dingtalkRobotId") REFERENCES "dingtalk_robots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_identities" ADD CONSTRAINT "security_identities_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "security_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_tickets" ADD CONSTRAINT "security_tickets_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "security_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_executions" ADD CONSTRAINT "security_executions_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "security_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_findings" ADD CONSTRAINT "security_findings_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "security_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_findings" ADD CONSTRAINT "security_findings_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "security_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_traffic" ADD CONSTRAINT "security_traffic_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "security_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_traffic" ADD CONSTRAINT "security_traffic_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "security_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_artifacts" ADD CONSTRAINT "security_artifacts_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "security_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_artifacts" ADD CONSTRAINT "security_artifacts_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "security_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "security_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "security_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
