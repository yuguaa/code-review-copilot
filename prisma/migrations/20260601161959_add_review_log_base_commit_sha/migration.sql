ALTER TABLE "review_logs" ADD COLUMN "baseCommitSha" TEXT;
ALTER TABLE "review_logs" ADD COLUMN "pushCommitShasJson" JSONB;
