-- AlterTable
ALTER TABLE "repositories" ADD COLUMN     "dingtalkSecret" TEXT,
ADD COLUMN     "dingtalkWebhook" TEXT,
ADD COLUMN     "enableDingtalk" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "enableMrComment" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "memory" TEXT;
