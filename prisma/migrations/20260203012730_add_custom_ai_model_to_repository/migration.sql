-- AlterTable
ALTER TABLE "repositories" ADD COLUMN "customApiEndpoint" TEXT;
ALTER TABLE "repositories" ADD COLUMN "customApiKey" TEXT;
ALTER TABLE "repositories" ADD COLUMN "customMaxTokens" INTEGER;
ALTER TABLE "repositories" ADD COLUMN "customModelId" TEXT;
ALTER TABLE "repositories" ADD COLUMN "customProvider" TEXT;
ALTER TABLE "repositories" ADD COLUMN "customTemperature" REAL;
