/*
  Warnings:

  - You are about to drop the `branch_configs` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `branchConfigId` on the `review_logs` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "repositories" ADD COLUMN "customPrompt" TEXT;
ALTER TABLE "repositories" ADD COLUMN "watchBranches" TEXT;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "branch_configs";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_review_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repositoryId" TEXT NOT NULL,
    "mergeRequestId" INTEGER NOT NULL,
    "mergeRequestIid" INTEGER NOT NULL,
    "sourceBranch" TEXT NOT NULL,
    "targetBranch" TEXT NOT NULL,
    "author" TEXT NOT NULL,
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
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "review_logs_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_review_logs" ("author", "commitSha", "commitShortId", "completedAt", "criticalIssues", "description", "error", "id", "mergeRequestId", "mergeRequestIid", "normalIssues", "repositoryId", "reviewedFiles", "sourceBranch", "startedAt", "status", "suggestions", "targetBranch", "title", "totalFiles") SELECT "author", "commitSha", "commitShortId", "completedAt", "criticalIssues", "description", "error", "id", "mergeRequestId", "mergeRequestIid", "normalIssues", "repositoryId", "reviewedFiles", "sourceBranch", "startedAt", "status", "suggestions", "targetBranch", "title", "totalFiles" FROM "review_logs";
DROP TABLE "review_logs";
ALTER TABLE "new_review_logs" RENAME TO "review_logs";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
