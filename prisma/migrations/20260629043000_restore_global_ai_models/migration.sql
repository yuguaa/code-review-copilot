-- CreateTable
CREATE TABLE "ai_models" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "apiBaseUrl" TEXT,
    "maxSteps" INTEGER NOT NULL DEFAULT 16,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "repositories"
ADD COLUMN "defaultAIModelId" TEXT,
ADD COLUMN "customProvider" TEXT,
ADD COLUMN "customModelId" TEXT,
ADD COLUMN "customApiKey" TEXT,
ADD COLUMN "customApiBaseUrl" TEXT,
ADD COLUMN "customMaxSteps" INTEGER;

-- Backfill global models from existing per-repository model config.
INSERT INTO "ai_models" (
    "id",
    "provider",
    "modelId",
    "apiKey",
    "apiBaseUrl",
    "maxSteps",
    "isDefault",
    "isActive",
    "createdAt",
    "updatedAt"
)
SELECT
    'model_' || md5("modelProvider" || ':' || "modelId" || ':' || "apiKey" || ':' || COALESCE("apiBaseUrl", '')),
    "modelProvider",
    "modelId",
    "apiKey",
    "apiBaseUrl",
    "maxSteps",
    row_number() OVER (ORDER BY "updatedAt" DESC) = 1,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "repositories"
GROUP BY "modelProvider", "modelId", "apiKey", "apiBaseUrl", "maxSteps", "updatedAt"
ON CONFLICT ("id") DO NOTHING;

UPDATE "repositories"
SET "defaultAIModelId" = 'model_' || md5("modelProvider" || ':' || "modelId" || ':' || "apiKey" || ':' || COALESCE("apiBaseUrl", ''));

-- AlterTable
ALTER TABLE "repositories"
DROP COLUMN "modelProvider",
DROP COLUMN "modelId",
DROP COLUMN "apiKey",
DROP COLUMN "apiBaseUrl",
DROP COLUMN "maxSteps";

-- CreateIndex
CREATE INDEX "repositories_defaultAIModelId_idx" ON "repositories"("defaultAIModelId");

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_defaultAIModelId_fkey" FOREIGN KEY ("defaultAIModelId") REFERENCES "ai_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;
