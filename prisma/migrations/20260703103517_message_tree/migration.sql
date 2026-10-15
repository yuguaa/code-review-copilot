ALTER TABLE "sessions" ADD COLUMN "activeLeafMessageId" TEXT;

ALTER TABLE "messages" ADD COLUMN "parentId" TEXT;

UPDATE "messages" AS m
SET "parentId" = lagged."parentId"
FROM (
  SELECT
    "id",
    LAG("id") OVER (PARTITION BY "sessionId" ORDER BY "createdAt" ASC, "id" ASC) AS "parentId"
  FROM "messages"
) AS lagged
WHERE m."id" = lagged."id";

UPDATE "sessions" AS s
SET "activeLeafMessageId" = ranked."id"
FROM (
  SELECT
    "id",
    "sessionId",
    ROW_NUMBER() OVER (PARTITION BY "sessionId" ORDER BY "createdAt" DESC, "id" DESC) AS "reverseRank"
  FROM "messages"
) AS ranked
WHERE s."id" = ranked."sessionId" AND ranked."reverseRank" = 1;

CREATE INDEX "messages_parentId_createdAt_idx" ON "messages"("parentId", "createdAt");

ALTER TABLE "messages" ADD CONSTRAINT "messages_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_activeLeafMessageId_fkey" FOREIGN KEY ("activeLeafMessageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
