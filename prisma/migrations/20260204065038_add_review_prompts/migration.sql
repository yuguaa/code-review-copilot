-- AlterTable
ALTER TABLE "review_logs" ADD COLUMN "aiModelId" TEXT;
ALTER TABLE "review_logs" ADD COLUMN "aiModelProvider" TEXT;
ALTER TABLE "review_logs" ADD COLUMN "reviewPrompts" TEXT;
