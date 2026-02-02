-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_repositories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gitLabProjectId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "description" TEXT,
    "gitLabAccountId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "autoReview" BOOLEAN NOT NULL DEFAULT false,
    "defaultAIModelId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "repositories_gitLabAccountId_fkey" FOREIGN KEY ("gitLabAccountId") REFERENCES "gitlab_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "repositories_defaultAIModelId_fkey" FOREIGN KEY ("defaultAIModelId") REFERENCES "ai_models" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_repositories" ("autoReview", "createdAt", "description", "gitLabAccountId", "gitLabProjectId", "id", "isActive", "name", "path", "updatedAt") SELECT "autoReview", "createdAt", "description", "gitLabAccountId", "gitLabProjectId", "id", "isActive", "name", "path", "updatedAt" FROM "repositories";
DROP TABLE "repositories";
ALTER TABLE "new_repositories" RENAME TO "repositories";
CREATE UNIQUE INDEX "repositories_gitLabProjectId_gitLabAccountId_key" ON "repositories"("gitLabProjectId", "gitLabAccountId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
