CREATE TABLE "review_workflow_nodes" (
  "id" TEXT NOT NULL,
  "reviewLogId" TEXT NOT NULL,
  "reviewBotRunId" TEXT,
  "nodeKey" TEXT NOT NULL,
  "parentNodeKey" TEXT,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "detail" TEXT,
  "sequence" INTEGER NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  "metricsJson" JSONB,
  "rawJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "review_workflow_nodes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "review_workflow_nodes_reviewLogId_nodeKey_key"
ON "review_workflow_nodes"("reviewLogId", "nodeKey");

CREATE INDEX "review_workflow_nodes_reviewLogId_sequence_idx"
ON "review_workflow_nodes"("reviewLogId", "sequence");

CREATE INDEX "review_workflow_nodes_reviewLogId_status_idx"
ON "review_workflow_nodes"("reviewLogId", "status");

CREATE INDEX "review_workflow_nodes_reviewBotRunId_idx"
ON "review_workflow_nodes"("reviewBotRunId");

ALTER TABLE "review_workflow_nodes"
ADD CONSTRAINT "review_workflow_nodes_reviewLogId_fkey"
FOREIGN KEY ("reviewLogId") REFERENCES "review_logs"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "review_workflow_nodes"
ADD CONSTRAINT "review_workflow_nodes_reviewBotRunId_fkey"
FOREIGN KEY ("reviewBotRunId") REFERENCES "review_bot_runs"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
