-- Add per-bot review budgets. These defaults preserve the current runtime limits
-- while allowing large-repository bots to opt into wider context retrieval.
ALTER TABLE "repository_review_bots" ADD COLUMN "maxIterations" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "repository_review_bots" ADD COLUMN "maxContextFiles" INTEGER NOT NULL DEFAULT 12;
ALTER TABLE "repository_review_bots" ADD COLUMN "maxCallGraphDepth" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "repository_review_bots" ADD COLUMN "maxFindings" INTEGER NOT NULL DEFAULT 50;
