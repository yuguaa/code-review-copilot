/*
  Warnings:

  - You are about to drop the column `name` on the `ai_models` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ai_models" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "apiEndpoint" TEXT,
    "maxTokens" INTEGER,
    "temperature" REAL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ai_models" ("apiEndpoint", "apiKey", "createdAt", "id", "isActive", "maxTokens", "modelId", "provider", "temperature", "updatedAt") SELECT "apiEndpoint", "apiKey", "createdAt", "id", "isActive", "maxTokens", "modelId", "provider", "temperature", "updatedAt" FROM "ai_models";
DROP TABLE "ai_models";
ALTER TABLE "new_ai_models" RENAME TO "ai_models";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
