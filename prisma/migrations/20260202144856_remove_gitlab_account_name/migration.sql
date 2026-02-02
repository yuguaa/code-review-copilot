/*
  Warnings:

  - You are about to drop the column `name` on the `gitlab_accounts` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_gitlab_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "url" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "webhookSecret" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_gitlab_accounts" ("accessToken", "createdAt", "id", "isActive", "updatedAt", "url", "webhookSecret") SELECT "accessToken", "createdAt", "id", "isActive", "updatedAt", "url", "webhookSecret" FROM "gitlab_accounts";
DROP TABLE "gitlab_accounts";
ALTER TABLE "new_gitlab_accounts" RENAME TO "gitlab_accounts";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
