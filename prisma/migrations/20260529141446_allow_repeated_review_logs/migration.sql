DROP INDEX IF EXISTS "review_logs_repositoryId_mergeRequestIid_commitSha_key";

CREATE INDEX IF NOT EXISTS "review_logs_repositoryId_mergeRequestIid_commitSha_idx"
ON "review_logs"("repositoryId", "mergeRequestIid", "commitSha");
