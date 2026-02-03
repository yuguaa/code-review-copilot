-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_review_comments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reviewLogId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "lineRangeEnd" INTEGER,
    "severity" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "diffHunk" TEXT,
    "gitlabCommentId" TEXT,
    "isPosted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "review_comments_reviewLogId_fkey" FOREIGN KEY ("reviewLogId") REFERENCES "review_logs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_review_comments" ("content", "createdAt", "diffHunk", "filePath", "gitlabCommentId", "id", "isPosted", "lineNumber", "lineRangeEnd", "reviewLogId", "severity", "updatedAt") SELECT "content", "createdAt", "diffHunk", "filePath", "gitlabCommentId", "id", "isPosted", "lineNumber", "lineRangeEnd", "reviewLogId", "severity", "updatedAt" FROM "review_comments";
DROP TABLE "review_comments";
ALTER TABLE "new_review_comments" RENAME TO "review_comments";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
