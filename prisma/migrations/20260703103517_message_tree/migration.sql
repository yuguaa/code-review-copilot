ALTER TABLE "sessions" ADD COLUMN "activeLeafMessageId" TEXT;

ALTER TABLE "messages" ADD COLUMN "parentId" TEXT;

WITH ordered AS (
  SELECT
    "id",
    "sessionId",
    LAG("id") OVER (PARTITION BY "sessionId" ORDER BY "createdAt" ASC, "id" ASC) AS "parentId",
    ROW_NUMBER() OVER (PARTITION BY "sessionId" ORDER BY "createdAt" DESC, "id" DESC) AS "reverseRank"
  FROM "messages"
)
UPDATE "messages" AS m
SET "parentId" = ordered."parentId"
FROM ordered
WHERE m."id" = ordered."id";

UPDATE "sessions" AS s
SET "activeLeafMessageId" = ordered."id"
FROM ordered
WHERE s."id" = ordered."sessionId" AND ordered."reverseRank" = 1;

CREATE INDEX "messages_parentId_createdAt_idx" ON "messages"("parentId", "createdAt");

ALTER TABLE "messages" ADD CONSTRAINT "messages_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_activeLeafMessageId_fkey" FOREIGN KEY ("activeLeafMessageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
